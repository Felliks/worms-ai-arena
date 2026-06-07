///<reference path="../Game.ts"/>
///<reference path="../Settings.ts"/>
///<reference path="ArenaSnapshot.ts"/>
///<reference path="ArenaTelemetry.ts"/>

var ArenaControllerInstance: ArenaController;

class ArenaController
{
    static TEAM_COLORS = ["#D72638", "#1E88E5", "#12AB00", "#B46DD2", "#FA6C1D", "#23A3C6", "#9A4C44", "#F9A825"];

    game: Game;
    enabled;
    busy;
    lastTurnKey;
    previousFeedback;
    turnNumber;
    teamConfigs;
    overlay;
    logEl;
    failedTurnKeys;
    activeAiTurn;
    activeAiTurnWatcher;
    chatHistory;
    wormMemories;
    currentPhysicalTurnKey;
    sameTurnBatchCounts;
    physicalTurnDeadlines;

    constructor(game)
    {
        this.game = game;
        this.enabled = Settings.ARENA_AUTO_START;
        this.busy = false;
        this.lastTurnKey = "";
        this.previousFeedback = "";
        this.turnNumber = 0;
        this.teamConfigs = [];
        this.failedTurnKeys = {};
        this.activeAiTurn = null;
        this.activeAiTurnWatcher = null;
        this.chatHistory = [];
        this.wormMemories = {};
        this.currentPhysicalTurnKey = "";
        this.sameTurnBatchCounts = {};
        this.physicalTurnDeadlines = {};
    }

    isEnabled()
    {
        return this.enabled;
    }

    // The resolved menu config (names, colours, personas, connection cascade),
    // or null for the legacy ?arena= URL launch path.
    getRuntime()
    {
        return (typeof ArenaConfig != "undefined" && ArenaConfig.runtime) ? ArenaConfig.runtime : null;
    }

    configureTeams()
    {
        this.teamConfigs = [];
        var rt = this.getRuntime();
        var types = Settings.ARENA_TEAM_TYPES.length > 0 ? Settings.ARENA_TEAM_TYPES : ["human", "human"];
        for (var i = 0; i < types.length; i++)
        {
            var rtTeam = rt && rt.teams[i] ? rt.teams[i] : null;
            var type = String(types[i]).toLowerCase();
            var isVision = type == "vlm" || type == "vision";
            var isHuman = type == "human" || type == "person";
            var model = Settings.ARENA_TEAM_MODELS[i] || "";
            var modelLabel = model ? " [" + model + "]" : "";
            this.teamConfigs.push({
                index: i,
                kind: isHuman ? "human" : "llm",
                provider: isHuman ? "human" : "server",
                model: model,
                perception: isVision ? "text+vision" : "text",
                personality: rtTeam ? rtTeam.personality : (i % 2 == 0 ? "reckless aggressor" : "defensive survivor"),
                chatLanguage: Settings.ARENA_CHAT_LANGUAGE,
                displayName: rtTeam ? rtTeam.displayName : ((isHuman ? "Human Team " + i : (isVision ? "VLM Team " + i : "LLM Team " + i)) + modelLabel)
            });
        }

        if (this.game.players)
        {
            for (var p = 0; p < this.game.players.length; p++)
            {
                var config = this.teamConfigs[p];
                if (config)
                {
                    var team = this.game.players[p].getTeam();
                    var rtTeam2 = rt && rt.teams[p] ? rt.teams[p] : null;
                    team.name = config.displayName;
                    team.color = (rtTeam2 && rtTeam2.color) ? rtTeam2.color : ArenaController.TEAM_COLORS[p % ArenaController.TEAM_COLORS.length];
                    for (var w = 0; w < team.worms.length; w++)
                    {
                        if (rtTeam2 && rtTeam2.worms[w] && rtTeam2.worms[w].name)
                        {
                            team.worms[w].name = rtTeam2.worms[w].name;
                        }
                        team.worms[w].preRendering();
                    }
                }
            }
        }
    }

    // Cascade resolution (worm -> team -> global) for the worm whose turn it is.
    resolveWormRuntime(playerIndex)
    {
        var rt = this.getRuntime();
        if (!rt || !rt.teams[playerIndex])
        {
            return null;
        }
        var slot = 0;
        try { slot = this.game.players[playerIndex].getTeam().currentWorm; } catch (e) { slot = 0; }
        var worms = rt.teams[playerIndex].worms || [];
        return worms[slot] || worms[0] || null;
    }

    start()
    {
        if (!this.enabled)
        {
            return;
        }

        this.configureTeams();
        this.ensureOverlay();
        this.debug("arena/start", {
            mode: Settings.ARENA_MODE,
            endpoint: Settings.ARENA_AGENT_ENDPOINT,
            chatLanguage: Settings.ARENA_CHAT_LANGUAGE,
            memoryStrategy: Settings.ARENA_MEMORY_STRATEGY,
            memoryWindow: Settings.ARENA_MEMORY_WINDOW,
            teams: this.teamConfigs
        });
    }

    controlsPlayer(player)
    {
        if (!this.enabled || !player || !this.game.players)
        {
            return false;
        }

        var index = this.game.players.indexOf(player);
        var config = this.teamConfigs[index];
        return config && config.kind != "human";
    }

    update()
    {
        if (!this.enabled || !this.game.state || !this.game.state.isStarted || this.game.winner)
        {
            return;
        }

        this.watchActiveAiTurn();

        if (this.busy)
        {
            return;
        }

        if (!this.game.state.physicsWorldSettled || this.game.state.hasNextTurnBeenTiggered())
        {
            return;
        }

        var player = this.game.state.getCurrentPlayer();
        var playerIndex = this.game.players.indexOf(player);
        var config = this.teamConfigs[playerIndex];

        if (!config || config.kind == "human")
        {
            return;
        }

        var worm = player.getTeam().getCurrentWorm();
        var turnKey = player.id + ":" + worm.name + ":" + player.getTeam().currentWorm;
        if (turnKey == this.lastTurnKey)
        {
            return;
        }

        this.lastTurnKey = turnKey;
        this.runAiTurn(playerIndex, config, turnKey);
    }

    runAiTurn(playerIndex, config, physicalTurnKey)
    {
        this.busy = true;

        var player = this.game.players[playerIndex];
        var worm = player.getTeam().getCurrentWorm();
        var wormId = this.wormId(playerIndex, worm.name);
        var turnKey = physicalTurnKey || (player.id + ":" + worm.name + ":" + player.getTeam().currentWorm);
        var sameTurnBatch = this.registerSameTurnBatch(turnKey);
        var remainingTurnMs = this.physicalTurnRemainingMs(turnKey);
        if (remainingTurnMs <= 0)
        {
            this.turnNumber++;
            this.previousFeedback = [
                "## Engine feedback",
                "",
                "- Physical worm-turn timer expired. The engine advances to the next player."
            ].join("\n");
            this.appendWormMemory(wormId, worm.name, "Physical worm-turn timer expired before the turn ended by shot, death, water, mine, or physics turn change.");
            this.postAgentEvent("ai-physical-turn-timeout", {
                physicalTurnKey: turnKey,
                sameTurnBatch: sameTurnBatch,
                remainingTurnMs: remainingTurnMs,
                feedbackMarkdown: this.previousFeedback,
                playerIndex: playerIndex,
                wormName: worm.name
            });
            this.busy = false;
            this.game.state.timerTiggerNextTurn();
            return;
        }

        this.turnNumber++;

        var wormMemory = this.getWormMemory(wormId, worm.name);
        var interactionInboxMarkdown = this.formatInteractionInbox(wormMemory);
        var turnContext: any = {
            requestId: null,
            playerIndex: playerIndex,
            wormName: worm.name,
            wormId: wormId,
            turnNumber: this.turnNumber,
            physicalTurnKey: turnKey,
            sameTurnBatch: sameTurnBatch,
            physicalTurnDeadlineAt: this.physicalTurnDeadlines[turnKey],
            turnTimeRemainingMs: remainingTurnMs,
            timedOut: false,
            endedByGame: false,
            executingActions: false,
            endedByGameLogged: false,
            abortController: typeof AbortController != "undefined" ? new AbortController() : null,
            timeoutId: null
        };
        turnContext.timeoutId = setTimeout(() =>
        {
            this.timeoutAiTurn(turnContext);
        }, Math.max(250, remainingTurnMs));
        this.activeAiTurn = turnContext;

        var snapshot = ArenaSnapshot.toMarkdown(this.game, config, this.previousFeedback);
        var requestId = "browser-turn-" + this.turnNumber + "-team-" + playerIndex + "-" + Date.now();
        turnContext.requestId = requestId;

        // Resolve the menu config (connection cascade + persona override) for the
        // worm whose turn it is. Falls back to the legacy per-team config when no
        // menu runtime is present (e.g. the ?arena= URL launch path).
        var wormRuntime = this.resolveWormRuntime(playerIndex);
        var resolvedModel = config.model || undefined;
        var resolvedPersonality = config.personality;
        var resolvedProfile = this.formatWormProfile(worm.name);
        var resolvedConnection = null;
        if (wormRuntime)
        {
            if (wormRuntime.personalityShort) { resolvedPersonality = wormRuntime.personalityShort; }
            if (wormRuntime.personaMarkdown) { resolvedProfile = wormRuntime.personaMarkdown; }
            resolvedConnection = wormRuntime.connection || null;
            if (resolvedConnection && resolvedConnection.model) { resolvedModel = resolvedConnection.model; }
        }

        var payload: any = {
            requestId: requestId,
            matchId: "local-browser",
            turnId: this.turnNumber,
            teamIndex: playerIndex,
            teamName: this.game.players[playerIndex].getTeam().name,
            personality: resolvedPersonality,
            chatLanguage: config.chatLanguage,
            wormId: wormId,
            wormName: worm.name,
            wormProfileMarkdown: resolvedProfile,
            wormMemoryMarkdown: this.formatWormMemory(wormMemory),
            chatHistoryMarkdown: this.formatChatHistory(),
            interactionInboxMarkdown: interactionInboxMarkdown,
            memoryStrategy: Settings.ARENA_MEMORY_STRATEGY,
            memoryWindow: Settings.ARENA_MEMORY_WINDOW,
            sameTurnBatch: sameTurnBatch,
            turnTimeRemainingMs: remainingTurnMs,
            model: resolvedModel,
            perception: config.perception,
            snapshotMarkdown: snapshot,
            feedbackMarkdown: this.previousFeedback
        };

        // Per-request connection (only when a real Base URL is configured; the
        // demo/mock connection sends model:"mock" with no creds).
        if (resolvedConnection && resolvedConnection.baseURL)
        {
            payload.baseURL = resolvedConnection.baseURL;
            if (resolvedConnection.apiKey) { payload.apiKey = resolvedConnection.apiKey; }
        }

        if (config.perception == "text+vision")
        {
            try
            {
                payload.screenshotDataUrl = ArenaSnapshot.captureVision(this.game);
            } catch (e)
            {
                payload.visionError = e.message;
            }
        }

        this.logAgentRequest(requestId, config, payload);
        this.markInboxDelivered(wormMemory);

        fetch(Settings.ARENA_AGENT_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: turnContext.abortController ? turnContext.abortController.signal : undefined
        })
            .then((response) =>
            {
                return response.text().then((text) =>
                {
                    var httpPayload = {
                        requestId: requestId,
                        status: response.status,
                        ok: response.ok,
                        responseText: text
                    };
                    this.debug("agent/http-response", httpPayload);
                    this.postAgentEvent("agent-http-response", httpPayload);

                    if (!response.ok)
                    {
                        throw new Error("HTTP " + response.status + " from " + Settings.ARENA_AGENT_ENDPOINT + ": " + text);
                    }

                    return JSON.parse(text);
                });
            })
            .then((decision) =>
            {
                if (!this.isAiTurnCurrent(turnContext))
                {
                    this.debug("agent/stale-decision", {
                        requestId: requestId,
                        context: turnContext,
                        decision: decision
                    });
                    return;
                }
                this.debug("agent/decision", {
                    requestId: requestId,
                    decision: decision
                });
                this.postAgentEvent("agent-decision", {
                    requestId: requestId,
                    turnNumber: turnContext.turnNumber,
                    sameTurnBatch: turnContext.sameTurnBatch,
                    playerIndex: turnContext.playerIndex,
                    wormName: turnContext.wormName,
                    decision: decision
                });
                this.handleDecision(config, decision, turnContext);
            })
            .catch((error) =>
            {
                if (turnContext.timedOut || turnContext.endedByGame)
                {
                    this.debug("agent/timeout-abort", {
                        requestId: requestId,
                        endedByGame: turnContext.endedByGame,
                        errorName: error.name,
                        errorMessage: error.message
                    });
                    return;
                }
                this.debug("agent/error", {
                    requestId: requestId,
                    endpoint: Settings.ARENA_AGENT_ENDPOINT,
                    pageOrigin: window.location.origin,
                    pageHref: window.location.href,
                    errorName: error.name,
                    errorMessage: error.message,
                    stack: error.stack
                });
                this.clearAiTurn(turnContext);
                this.busy = false;
            });
    }

    timeoutAiTurn(turnContext)
    {
        if (!this.isAiTurnCurrent(turnContext))
        {
            return;
        }

        turnContext.timedOut = true;
        if (turnContext.abortController)
        {
            turnContext.abortController.abort();
        }

        this.previousFeedback = "## Engine feedback\n\n- AI turn timed out after " + Math.round(Settings.PLAYER_TURN_TIME / 1000) + " seconds before a valid action batch completed. The engine advances to the next player.\n";
        this.appendWormMemory(turnContext.wormId, turnContext.wormName, "Turn " + turnContext.turnNumber + ": timed out before submitting a valid action batch.");
        this.postAgentEvent("ai-timeout", {
            feedbackMarkdown: this.previousFeedback,
            turnContext: {
                playerIndex: turnContext.playerIndex,
                        wormName: turnContext.wormName,
                        turnNumber: turnContext.turnNumber
                    }
        });
        this.clearAiTurn(turnContext);
        this.busy = false;
        this.game.state.timerTiggerNextTurn();
    }

    watchActiveAiTurn()
    {
        var turnContext = this.activeAiTurn;
        if (!turnContext || turnContext.timedOut)
        {
            return;
        }

        var currentPlayer = this.game.state.getCurrentPlayer();
        var currentIndex = this.game.players.indexOf(currentPlayer);
        var currentWorm = currentPlayer ? currentPlayer.getTeam().getCurrentWorm() : null;
        var gameEndedThisTurn = this.game.state.hasNextTurnBeenTiggered()
            || currentIndex != turnContext.playerIndex
            || !currentWorm
            || currentWorm.name != turnContext.wormName
            || currentWorm.isDead;

        if (!gameEndedThisTurn)
        {
            return;
        }

        turnContext.endedByGame = true;
        if (turnContext.abortController && !turnContext.executingActions)
        {
            turnContext.abortController.abort();
        }

        if (!turnContext.endedByGameLogged)
        {
            turnContext.endedByGameLogged = true;
            this.postAgentEvent("game-ended-ai-turn", {
                reason: {
                    nextTurnTriggered: this.game.state.hasNextTurnBeenTiggered(),
                    currentIndex: currentIndex,
                    expectedIndex: turnContext.playerIndex,
                    currentWorm: currentWorm ? currentWorm.name : null,
                    expectedWorm: turnContext.wormName,
                    currentWormDead: currentWorm ? currentWorm.isDead : null,
                    executingActions: turnContext.executingActions
                }
            });
        }

        if (turnContext.executingActions)
        {
            return;
        }

        this.clearAiTurn(turnContext);
        this.busy = false;
    }

    clearAiTurn(turnContext)
    {
        if (turnContext && turnContext.timeoutId)
        {
            clearTimeout(turnContext.timeoutId);
            turnContext.timeoutId = null;
        }
        if (this.activeAiTurn == turnContext)
        {
            this.activeAiTurn = null;
        }
    }

    isAiTurnCurrent(turnContext)
    {
        if (!turnContext || turnContext.timedOut || turnContext.endedByGame)
        {
            return false;
        }

        var currentPlayer = this.game.state.getCurrentPlayer();
        var currentIndex = this.game.players.indexOf(currentPlayer);
        if (currentIndex != turnContext.playerIndex)
        {
            return false;
        }

        var currentWorm = currentPlayer.getTeam().getCurrentWorm();
        return currentWorm && currentWorm.name == turnContext.wormName && !this.game.state.hasNextTurnBeenTiggered();
    }

    handleDecision(config, decision, turnContext)
    {
        turnContext.executingActions = true;
        this.executeActions(decision.actions || [], turnContext)
            .then((records) =>
            {
                turnContext.executingActions = false;
                if (turnContext.timedOut)
                {
                    this.clearAiTurn(turnContext);
                    this.busy = false;
                    return;
                }
                this.previousFeedback = ArenaTelemetry.formatActionFeedback(records, this.game);
                this.rememberExecutedTurn(turnContext, decision, records, this.previousFeedback);
                this.recordInteractionsFromRecords(turnContext, records);
                var feedbackPayload = {
                    feedbackMarkdown: this.previousFeedback,
                    actions: decision.actions || [],
                    records: records
                };
                this.debug("engine-feedback", feedbackPayload);
                this.postAgentEvent("engine-feedback", feedbackPayload);
                var shouldContinueSameAiTurn = this.isAiTurnCurrent(turnContext);
                if (shouldContinueSameAiTurn)
                {
                    this.debug("agent/continue-same-turn", {
                        playerIndex: turnContext.playerIndex,
                        wormName: turnContext.wormName,
                        turnNumber: turnContext.turnNumber,
                        sameTurnBatch: turnContext.sameTurnBatch,
                        turnTimeRemainingMs: this.physicalTurnRemainingMs(turnContext.physicalTurnKey),
                        reason: "Action batch did not end the game turn; requesting another AI decision with fresh feedback."
                    });
                    this.lastTurnKey = "";
                }
                this.clearAiTurn(turnContext);
                this.busy = false;
            });
    }

    executeActions(actions, turnContext)
    {
        var records = [];
        var chain = Promise.resolve();
        for (var i = 0; i < actions.length; i++)
        {
            ((action) =>
            {
                chain = chain.then(() =>
                {
                    if (!this.isAiTurnCurrent(turnContext))
                    {
                        return null;
                    }
                    return this.executeAction(action, turnContext);
                }).then((record) =>
                {
                    if (record)
                    {
                        records.push(record);
                        this.debug("tool/result", {
                            requestId: turnContext.requestId,
                            turnNumber: turnContext.turnNumber,
                            sameTurnBatch: turnContext.sameTurnBatch,
                            playerIndex: turnContext.playerIndex,
                            wormName: turnContext.wormName,
                            action: record.action,
                            record: record
                        });
                        this.postAgentEvent("tool-result", {
                            requestId: turnContext.requestId,
                            turnNumber: turnContext.turnNumber,
                            sameTurnBatch: turnContext.sameTurnBatch,
                            playerIndex: turnContext.playerIndex,
                            wormName: turnContext.wormName,
                            action: record.action,
                            record: record
                        });
                    }
                });
            })(actions[i]);
        }

        return chain.then(() => records);
    }

    executeAction(action, turnContext)
    {
        var player = this.game.state.getCurrentPlayer();
        var worm = player.getTeam().getCurrentWorm();
        this.debug("tool/call", {
            requestId: turnContext.requestId,
            turnNumber: turnContext.turnNumber,
            sameTurnBatch: turnContext.sameTurnBatch,
            playerIndex: turnContext.playerIndex,
            wormName: worm.name,
            action: action
        });
        this.postAgentEvent("tool-call", {
            requestId: turnContext.requestId,
            turnNumber: turnContext.turnNumber,
            sameTurnBatch: turnContext.sameTurnBatch,
            playerIndex: turnContext.playerIndex,
            wormName: worm.name,
            action: action
        });
        ArenaTelemetry.startAction(action, worm);
        var tool = action.tool || action.type;

        if (tool == "say")
        {
            this.addLog({
                wormName: worm.name,
                teamName: player.getTeam().name,
                teamColor: player.getTeam().color
            }, action.text || "");
            ArenaTelemetry.addNote("Said: " + (action.text || ""));
            return this.wait(100, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "inspect_inventory")
        {
            ArenaTelemetry.addNote(this.formatInventory(player));
            return this.wait(action.ms || 250, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "select_weapon")
        {
            this.selectWeapon(player, action.weapon, action.index);
            return this.wait(250, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "walk")
        {
            return this.walk(worm, action.direction, action.steps || 12, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "jetpack_start")
        {
            this.startJetPack(player, worm);
            return this.wait(250, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "jetpack_thrust")
        {
            return this.jetpackThrust(player, worm, action.direction, action.ms || 700, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "jetpack_stop")
        {
            this.stopJetPack(player);
            return this.wait(250, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "rope_fire")
        {
            this.fireRope(player, worm);
            return this.wait(action.ms || 600, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "rope_swing")
        {
            return this.ropeSwing(player, worm, action.direction, action.ms || 900, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "rope_contract" || tool == "rope_expand")
        {
            return this.ropeAdjust(player, tool == "rope_contract" ? "contract" : "expand", action.ms || 500, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "rope_release")
        {
            this.releaseRope(player);
            return this.wait(250, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "jump")
        {
            worm.jump();
            ArenaTelemetry.addNote("Jump requested.");
            return this.wait(action.ms || 700, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "backflip")
        {
            worm.backFlip();
            ArenaTelemetry.addNote("Backflip requested.");
            return this.wait(action.ms || 900, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "aim")
        {
            this.setAim(worm, action.degrees);
            return this.wait(200, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "aim_delta")
        {
            worm.target.aim(action.degrees || 0);
            ArenaTelemetry.addNote("Adjusted aim by " + (action.degrees || 0) + " input units.");
            return this.wait(200, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "set_power")
        {
            worm.getWeapon().getForceIndicator().setForcePercentage(action.percent || 1);
            ArenaTelemetry.addNote("Set force meter to " + (action.percent || 1) + "%.");
            return this.wait(200, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "fire")
        {
            worm.fire();
            ArenaTelemetry.addNote("Fire requested with " + worm.getWeapon().name + ".");
            return this.wait(action.observeMs || 5200, turnContext, true).then(() => ArenaTelemetry.finishAction());
        }

        if (tool == "wait")
        {
            return this.wait(action.ms || 500, turnContext).then(() => ArenaTelemetry.finishAction());
        }

        ArenaTelemetry.addNote("Unknown tool `" + tool + "` ignored.");
        return this.wait(100, turnContext).then(() => ArenaTelemetry.finishAction());
    }

    selectWeapon(player, weaponName, index)
    {
        var manager = player.getTeam().getWeaponManager();
        var list = manager.getListOfWeapons();
        var selected = typeof index == "number" ? index : -1;
        if (selected < 0 && weaponName)
        {
            var expected = String(weaponName).toLowerCase();
            for (var i = 0; i < list.length; i++)
            {
                if (String(list[i].name).toLowerCase() == expected)
                {
                    selected = i;
                }
            }
        }

        if (selected >= 0 && selected < list.length)
        {
            manager.setCurrentWeapon(selected);
            GameInstance.weaponMenu.refresh();
            ArenaTelemetry.addNote("Selected weapon `" + list[selected].name + "`.");
            ArenaTelemetry.addNote(this.weaponUseGuidance(list[selected]));
            return list[selected];
        } else
        {
            ArenaTelemetry.addNote("Weapon `" + weaponName + "` was not found.");
        }
        return null;
    }

    findWeapon(player, weaponName)
    {
        var manager = player.getTeam().getWeaponManager();
        var list = manager.getListOfWeapons();
        var expected = String(weaponName || "").toLowerCase();
        for (var i = 0; i < list.length; i++)
        {
            if (String(list[i].name || "").toLowerCase() == expected)
            {
                return { weapon: list[i], index: i };
            }
        }
        return null;
    }

    ensureWeapon(player, weaponName)
    {
        var found = this.findWeapon(player, weaponName);
        if (!found)
        {
            ArenaTelemetry.addNote("Weapon `" + weaponName + "` was not found.");
            return null;
        }
        player.getTeam().getWeaponManager().setCurrentWeapon(found.index);
        GameInstance.weaponMenu.refresh();
        return found.weapon;
    }

    positionNote(worm)
    {
        var pos = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
        return "(" + Math.round(pos.x) + ", " + Math.round(pos.y) + ")";
    }

    startJetPack(player, worm)
    {
        var weapon = this.ensureWeapon(player, "Jet Pack");
        if (!weapon)
        {
            return null;
        }
        if (!weapon.getIsActive())
        {
            worm.fire();
        }
        ArenaTelemetry.addNote("Jet Pack start requested; active " + weapon.getIsActive() + ", ammo " + weapon.ammo + ", fuel " + Math.round(weapon.fuel || 0) + ".");
        return weapon;
    }

    stopJetPack(player)
    {
        var found = this.findWeapon(player, "Jet Pack");
        if (found && found.weapon.getIsActive())
        {
            found.weapon.deactivate();
            ArenaTelemetry.addNote("Jet Pack stopped.");
        } else
        {
            ArenaTelemetry.addNote("Jet Pack stop requested, but it was not active.");
        }
    }

    jetpackThrust(player, worm, direction, ms, turnContext)
    {
        var weapon = this.ensureWeapon(player, "Jet Pack");
        var duration = Math.max(100, Math.min(5000, Math.round(ms || 700)));
        if (!weapon)
        {
            return this.wait(100, turnContext);
        }
        if (!weapon.getIsActive())
        {
            worm.fire();
        }
        if (!weapon.getIsActive())
        {
            ArenaTelemetry.addNote("Jet Pack thrust could not start; ammo may be empty.");
            return this.wait(100, turnContext);
        }

        var dir = String(direction || "up").toLowerCase();
        var startPos = this.positionNote(worm);
        var startFuel = Math.round(weapon.fuel || 0);
        var start = Date.now();
        var pulse = () =>
        {
            if (!this.isAiTurnCurrent(turnContext) || !weapon.getIsActive())
            {
                return Promise.resolve(null);
            }
            if (weapon.applyAiThrust)
            {
                weapon.applyAiThrust(dir);
            } else
            {
                if (dir == "up" || dir == "up_left" || dir == "up_right")
                {
                    weapon.up();
                }
                if (dir == "left" || dir == "up_left")
                {
                    weapon.left();
                }
                if (dir == "right" || dir == "up_right")
                {
                    weapon.right();
                }
            }
            if (Date.now() - start >= duration)
            {
                return Promise.resolve(null);
            }
            return this.wait(45, turnContext).then(pulse);
        };

        return pulse().then(() =>
        {
            ArenaTelemetry.addNote("Jet Pack thrust `" + dir + "` for " + duration + " ms. Start " + startPos + ", end " + this.positionNote(worm) + ", fuel " + startFuel + " -> " + Math.round(weapon.fuel || 0) + ".");
        });
    }

    fireRope(player, worm)
    {
        var weapon = this.ensureWeapon(player, "Ninja Rope");
        if (!weapon)
        {
            return null;
        }
        worm.fire();
        var active = weapon.getIsActive();
        var anchor = weapon.anchor ? Physics.vectorMetersToPixels(weapon.anchor.GetPosition().Copy()) : null;
        ArenaTelemetry.addNote("Ninja Rope fired; active " + active + (anchor ? ", anchor (" + Math.round(anchor.x) + ", " + Math.round(anchor.y) + ")" : ", no anchor") + ".");
        return weapon;
    }

    currentRope(player)
    {
        var found = this.findWeapon(player, "Ninja Rope");
        return found ? found.weapon : null;
    }

    ropeAdjust(player, mode, ms, turnContext)
    {
        var rope = this.currentRope(player);
        var duration = Math.max(100, Math.min(5000, Math.round(ms || 500)));
        if (!rope || !rope.getIsActive())
        {
            ArenaTelemetry.addNote("Ninja Rope " + mode + " requested, but rope is not attached.");
            return this.wait(100, turnContext);
        }

        var startSegments = rope.ropeJoints ? rope.ropeJoints.length : 0;
        var start = Date.now();
        var pulse = () =>
        {
            if (!this.isAiTurnCurrent(turnContext) || !rope.getIsActive())
            {
                return Promise.resolve(null);
            }
            if (mode == "contract")
            {
                rope.contract();
            } else
            {
                rope.expand();
            }
            if (Date.now() - start >= duration)
            {
                return Promise.resolve(null);
            }
            return this.wait(120, turnContext).then(pulse);
        };

        return pulse().then(() =>
        {
            var endSegments = rope.ropeJoints ? rope.ropeJoints.length : 0;
            ArenaTelemetry.addNote("Ninja Rope " + mode + " for " + duration + " ms; segments " + startSegments + " -> " + endSegments + ".");
        });
    }

    ropeSwing(player, worm, direction, ms, turnContext)
    {
        var rope = this.currentRope(player);
        var duration = Math.max(100, Math.min(5000, Math.round(ms || 700)));
        var dir = direction == "left" ? "left" : "right";
        if (!rope || !rope.getIsActive())
        {
            ArenaTelemetry.addNote("Ninja Rope swing `" + dir + "` requested, but rope is not attached.");
            return this.wait(100, turnContext);
        }

        var startPos = this.positionNote(worm);
        var start = Date.now();
        var pulse = () =>
        {
            if (!this.isAiTurnCurrent(turnContext) || !rope.getIsActive())
            {
                return Promise.resolve(null);
            }
            if (dir == "left")
            {
                worm.walkLeft();
            } else
            {
                worm.walkRight();
            }
            if (Date.now() - start >= duration)
            {
                return Promise.resolve(null);
            }
            return this.wait(45, turnContext).then(pulse);
        };

        return pulse().then(() =>
        {
            ArenaTelemetry.addNote("Ninja Rope swing `" + dir + "` for " + duration + " ms. Start " + startPos + ", end " + this.positionNote(worm) + ".");
        });
    }

    releaseRope(player)
    {
        var rope = this.currentRope(player);
        if (rope && rope.getIsActive())
        {
            rope.deactivate();
            ArenaTelemetry.addNote("Ninja Rope released.");
        } else
        {
            ArenaTelemetry.addNote("Ninja Rope release requested, but rope was not attached.");
        }
    }

    formatInventory(player)
    {
        var manager = player.getTeam().getWeaponManager();
        var list = manager.getListOfWeapons();
        var current = player.getTeam().getCurrentWorm().getWeapon();
        var lines = ["Inventory inspected. Current weapon: `" + current.name + "`."];
        for (var i = 0; i < list.length; i++)
        {
            lines.push(i + ": `" + list[i].name + "`, ammo " + list[i].ammo + ", requires aiming " + list[i].requiresAiming + ". " + this.weaponUseGuidance(list[i]));
        }
        return lines.join("\n");
    }

    weaponUseGuidance(weapon)
    {
        if (typeof ArenaSnapshot != "undefined" && ArenaSnapshot.weaponUseGuidance)
        {
            return ArenaSnapshot.weaponUseGuidance(weapon);
        }
        return "tactical use facts: inspect the Markdown state before selecting; risk: unclear item can waste turn time; agent primitives: select_weapon, then relevant movement/aim/fire primitives.";
    }

    setAim(worm, degrees)
    {
        var bounded = Math.max(-179, Math.min(179, Number(degrees || 0)));
        var radians = Utilies.toRadians(bounded);
        worm.direction = (bounded > 90 || bounded < -90) ? Worm.DIRECTION.left : Worm.DIRECTION.right;
        worm.target.direction = worm.direction;
        worm.target.setTargetDirection(Utilies.angleToVector(radians));
        ArenaTelemetry.addNote("Set aim to " + bounded + " degrees.");
    }

    walk(worm, direction, steps, turnContext)
    {
        if (direction != "left" && direction != "right")
        {
            ArenaTelemetry.addNote("Walk ignored: direction `" + direction + "` is invalid for walk. Use only left/right, or use Jet Pack thrust for up/up_left/up_right.");
            return this.wait(100, turnContext);
        }
        var count = Math.max(1, Math.min(160, Math.round(steps)));
        var chain = Promise.resolve();
        for (var i = 0; i < count; i++)
        {
            chain = chain.then(() =>
            {
                if (!this.isAiTurnCurrent(turnContext))
                {
                    return null;
                }
                if (direction == "left")
                {
                    worm.walkLeft();
                } else
                {
                    worm.walkRight();
                }
                return this.wait(28, turnContext);
            });
        }
        ArenaTelemetry.addNote("Walked " + direction + " for " + count + " primitive steps.");
        return chain;
    }

    registerSameTurnBatch(physicalTurnKey)
    {
        if (this.currentPhysicalTurnKey != physicalTurnKey)
        {
            this.currentPhysicalTurnKey = physicalTurnKey;
            this.sameTurnBatchCounts = {};
            this.physicalTurnDeadlines = {};
        }

        this.sameTurnBatchCounts[physicalTurnKey] = (this.sameTurnBatchCounts[physicalTurnKey] || 0) + 1;
        this.physicalTurnDeadline(physicalTurnKey);
        return this.sameTurnBatchCounts[physicalTurnKey];
    }

    physicalTurnDeadline(physicalTurnKey)
    {
        if (!this.physicalTurnDeadlines[physicalTurnKey])
        {
            this.physicalTurnDeadlines[physicalTurnKey] = Date.now() + Math.max(5000, Settings.PLAYER_TURN_TIME);
        }
        return this.physicalTurnDeadlines[physicalTurnKey];
    }

    physicalTurnRemainingMs(physicalTurnKey)
    {
        return Math.max(0, this.physicalTurnDeadline(physicalTurnKey) - Date.now());
    }

    wormId(teamIndex, wormName)
    {
        return "team-" + teamIndex + ":" + wormName;
    }

    hashName(name)
    {
        var hash = 0;
        var text = String(name || "");
        for (var i = 0; i < text.length; i++)
        {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    getWormProfileData(wormName)
    {
        var profiles = [
            {
                title: "reckless bazooka duelist",
                tactic: "Personality tendency: enjoys decisive explosive shots, accepts misses, and dislikes repeating a self-damaging lane.",
                chat: "short, cocky, direct"
            },
            {
                title: "patient survivor",
                tactic: "Personality tendency: values HP, stable footing, and patience when the position is bad.",
                chat: "dry, controlled, underplayed"
            },
            {
                title: "terrain reader",
                tactic: "Personality tendency: talks about walls, ceilings, water danger, and line clarity.",
                chat: "technical, smug, precise"
            },
            {
                title: "grenade gambler",
                tactic: "Personality tendency: likes arcing grenades and cluster opportunities, with visible nerves around friendly-fire risk.",
                chat: "theatrical, overconfident"
            },
            {
                title: "close-range saboteur",
                tactic: "Personality tendency: enjoys close-range sabotage, short movement, drill/dynamite ideas, and mocking distant blocked targets.",
                chat: "mean, concise, opportunistic"
            },
            {
                title: "revenge tracker",
                tactic: "Personality tendency: remembers recent damage and near misses as personal grudges.",
                chat: "personal, grudge-driven"
            },
            {
                title: "ray-weapon pragmatist",
                tactic: "Personality tendency: respects straight-line clearance and distrusts lobs through ceilings.",
                chat: "calm, dismissive"
            },
            {
                title: "chaos comedian",
                tactic: "Personality tendency: wants spectacle, jokes about mistakes, and remembers repeated misses.",
                chat: "funny, self-assured, punchy"
            }
        ];

        return profiles[this.hashName(wormName) % profiles.length];
    }

    formatWormProfile(wormName)
    {
        var profile = this.getWormProfileData(wormName);
        var tactic = String(profile.tactic || "").replace(/^Personality tendency:\s*/i, "");
        return [
            "## Worm profile",
            "- Name-bound profile for `" + wormName + "`.",
            "- Personality: " + profile.title + ".",
            "- Personality tendency: " + tactic,
            "- Chat style: " + profile.chat + "."
        ].join("\n");
    }

    getWormMemory(wormId, wormName)
    {
        if (!this.wormMemories[wormId])
        {
            this.wormMemories[wormId] = {
                id: wormId,
                name: wormName,
                summary: "",
                entries: [],
                pendingInteractions: [],
                deliveredInteractions: []
            };
        }
        return this.wormMemories[wormId];
    }

    appendWormMemory(wormId, wormName, text)
    {
        if (!wormId)
        {
            return;
        }

        var memory = this.getWormMemory(wormId, wormName || wormId);
        if (Settings.ARENA_MEMORY_STRATEGY == "none")
        {
            memory.summary = "";
            memory.entries = [];
            return;
        }

        memory.entries.push({
            turnNumber: this.turnNumber,
            text: text
        });
        this.applyMemoryPolicy(memory);
    }

    applyMemoryPolicy(memory)
    {
        var strategy = Settings.ARENA_MEMORY_STRATEGY;
        var limit = Math.max(0, Settings.ARENA_MEMORY_WINDOW);

        if (strategy == "none")
        {
            memory.summary = "";
            memory.entries = [];
            return;
        }

        if (strategy == "full")
        {
            return;
        }

        while (memory.entries.length > limit)
        {
            var dropped = memory.entries.shift();
            if (strategy == "summary" && dropped)
            {
                var summaryLine = "- Earlier turn " + dropped.turnNumber + ": " + dropped.text;
                memory.summary = memory.summary ? memory.summary + "\n" + summaryLine : summaryLine;
                var summaryLines = memory.summary.split("\n");
                if (summaryLines.length > Math.max(8, limit))
                {
                    memory.summary = summaryLines.slice(summaryLines.length - Math.max(8, limit)).join("\n");
                }
            }
        }
    }

    formatWormMemory(memory)
    {
        if (Settings.ARENA_MEMORY_STRATEGY == "none")
        {
            return "- Personal memory disabled by query parameter.";
        }

        var lines = [];
        if (memory.summary)
        {
            lines.push("### Rolling summary of older personal history");
            lines.push(memory.summary);
        }

        lines.push("### Recent personal turns");
        if (memory.entries.length == 0)
        {
            lines.push("- No previous personal turns recorded.");
        } else
        {
            for (var i = 0; i < memory.entries.length; i++)
            {
                lines.push("- Turn " + memory.entries[i].turnNumber + ": " + memory.entries[i].text);
            }
        }

        return lines.join("\n");
    }

    markInboxDelivered(memory)
    {
        if (!memory || memory.pendingInteractions.length == 0)
        {
            return;
        }

        memory.deliveredInteractions = memory.deliveredInteractions.concat(memory.pendingInteractions);
        var keep = Math.max(0, Settings.ARENA_MEMORY_WINDOW);
        if (Settings.ARENA_MEMORY_STRATEGY != "full" && memory.deliveredInteractions.length > keep)
        {
            var recent = memory.deliveredInteractions.slice(memory.deliveredInteractions.length - keep);
            var grudgeKeep = Math.max(keep * 3, 12);
            var oldGrudges = memory.deliveredInteractions
                .slice(Math.max(0, memory.deliveredInteractions.length - grudgeKeep))
                .filter((line) => this.isLongLivedGrudgeInteraction(line));
            var merged = oldGrudges.concat(recent);
            var seen = {};
            memory.deliveredInteractions = merged.filter(function (line)
            {
                if (seen[line])
                {
                    return false;
                }
                seen[line] = true;
                return true;
            });
        }
        memory.pendingInteractions = [];
    }

    isLongLivedGrudgeInteraction(line)
    {
        return /\(ally\).*damaged you|\(ally\).*caused an explosion|SELF DAMAGE|self-hit|self damage|\(self\).*damaged you/i.test(String(line || ""));
    }

    formatInteractionInbox(memory)
    {
        var lines = [];
        if (memory.pendingInteractions.length == 0)
        {
            lines.push("- No recorded direct interactions since your last turn.");
        } else
        {
            for (var i = 0; i < memory.pendingInteractions.length; i++)
            {
                lines.push("- " + memory.pendingInteractions[i]);
            }
        }

        if (memory.deliveredInteractions.length > 0)
        {
            if (Settings.ARENA_MEMORY_STRATEGY != "full")
            {
                var grudgeNotes = memory.deliveredInteractions.filter((line) => this.isLongLivedGrudgeInteraction(line));
                if (grudgeNotes.length > 0)
                {
                    lines.push("### Long-lived grudge notes");
                    var grudgeStart = Math.max(0, grudgeNotes.length - Math.max(4, Settings.ARENA_MEMORY_WINDOW));
                    for (var g = grudgeStart; g < grudgeNotes.length; g++)
                    {
                        lines.push("- " + grudgeNotes[g]);
                    }
                }
            }

            lines.push("### Previously delivered interaction notes");
            var keep = Settings.ARENA_MEMORY_STRATEGY == "full" ? memory.deliveredInteractions.length : Math.min(memory.deliveredInteractions.length, Math.max(0, Settings.ARENA_MEMORY_WINDOW));
            var start = memory.deliveredInteractions.length - keep;
            for (var d = start; d < memory.deliveredInteractions.length; d++)
            {
                lines.push("- " + memory.deliveredInteractions[d]);
            }
        }

        return lines.join("\n");
    }

    appendChatHistory(speaker, text)
    {
        var speakerLabel = typeof speaker == "string" ? speaker : speaker.wormName;
        var teamName = typeof speaker == "string" ? "" : speaker.teamName;
        this.chatHistory.push({
            turnNumber: this.turnNumber,
            speaker: speakerLabel,
            teamName: teamName,
            text: text
        });

        if (Settings.ARENA_MEMORY_STRATEGY != "full")
        {
            var keep = Math.max(0, Settings.ARENA_MEMORY_WINDOW);
            if (this.chatHistory.length > keep)
            {
                this.chatHistory = this.chatHistory.slice(this.chatHistory.length - keep);
            }
        }
    }

    formatChatHistory()
    {
        if (this.chatHistory.length == 0)
        {
            return "- Chat is empty.";
        }

        var lines = [];
        for (var i = 0; i < this.chatHistory.length; i++)
        {
            var item = this.chatHistory[i];
            var speaker = item.teamName ? item.speaker + " [" + item.teamName + "]" : item.speaker;
            lines.push("- Turn " + item.turnNumber + ", " + speaker + ": " + item.text);
        }
        return lines.join("\n");
    }

    compactFeedbackForMemory(feedback)
    {
        var lines = String(feedback || "").split("\n").filter(function (line)
        {
            return /Explosion at|Explosion relative|relative to `|Miss feedback|SELF DAMAGE|FRIENDLY FIRE|ENEMY HIT|Damage summary|Safety lesson|Shot produced no recorded|Voluntarily ended|Walked|Selected weapon|Set aim|Set force|Fire requested|Said:/.test(line);
        });

        if (lines.length == 0)
        {
            return "No notable feedback.";
        }

        return lines.slice(0, 18).join(" ");
    }

    rememberExecutedTurn(turnContext, decision, records, feedback)
    {
        var actions = (decision.actions || []).map(function (action)
        {
            var parts = [action.tool];
            if (action.weapon)
            {
                parts.push(action.weapon);
            }
            if (action.direction)
            {
                parts.push(action.direction + ":" + action.steps);
            }
            if (action.degrees != null)
            {
                parts.push("deg " + action.degrees);
            }
            if (action.percent != null)
            {
                parts.push("power " + action.percent);
            }
            return parts.join(" ");
        }).join(" -> ");

        var planParts = [];
        if (decision.target)
        {
            planParts.push("Target: " + decision.target);
        }
        if (decision.campaignPlan)
        {
            planParts.push("Campaign plan: " + decision.campaignPlan);
        }
        if (decision.nextTurnPlan)
        {
            planParts.push("Next turn plan: " + decision.nextTurnPlan);
        }
        var memoryLine = "I chose: " + actions + ". Public plan: " + (decision.thought || "none") + ". " + planParts.join(". ") + ". Feedback: " + this.compactFeedbackForMemory(feedback);
        this.appendWormMemory(turnContext.wormId, turnContext.wormName, memoryLine);
    }

    livingWormMemoryTargets()
    {
        var targets = [];
        if (!this.game || !this.game.players)
        {
            return targets;
        }

        for (var p = 0; p < this.game.players.length; p++)
        {
            var team = this.game.players[p].getTeam();
            for (var i = 0; i < team.worms.length; i++)
            {
                var worm = team.worms[i];
                if (worm.isDead)
                {
                    continue;
                }
                var pos = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
                targets.push({
                    id: this.wormId(p, worm.name),
                    name: worm.name,
                    team: team.name,
                    teamIndex: p,
                    x: Math.round(pos.x),
                    y: Math.round(pos.y),
                    hp: Math.round(worm.health)
                });
            }
        }

        return targets;
    }

    distancePixels(a, b)
    {
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        return Math.round(Math.sqrt((dx * dx) + (dy * dy)));
    }

    relationToTarget(actor, target)
    {
        if (!actor)
        {
            return "unknown";
        }
        if (actor.id == target.id || (actor.teamIndex == target.teamIndex && actor.name == target.name))
        {
            return "self";
        }
        return actor.teamIndex == target.teamIndex ? "ally" : "enemy";
    }

    appendInteraction(targetId, targetName, text)
    {
        var memory = this.getWormMemory(targetId, targetName || targetId);
        memory.pendingInteractions.push("Turn " + this.turnNumber + ": " + text);
        if (Settings.ARENA_MEMORY_STRATEGY != "full" && memory.pendingInteractions.length > Math.max(4, Settings.ARENA_MEMORY_WINDOW))
        {
            memory.pendingInteractions = memory.pendingInteractions.slice(memory.pendingInteractions.length - Math.max(4, Settings.ARENA_MEMORY_WINDOW));
        }
    }

    recordInteractionsFromRecords(turnContext, records)
    {
        var targets = this.livingWormMemoryTargets();
        for (var r = 0; r < records.length; r++)
        {
            var record = records[r];
            var actor = record.actor;
            if (!actor)
            {
                continue;
            }

            var damageRecords = record.damage || [];
            for (var d = 0; d < damageRecords.length; d++)
            {
                var damage = damageRecords[d];
                if (!damage.target || !damage.target.id)
                {
                    continue;
                }
                var relation = this.relationToTarget(actor, damage.target);
                this.appendInteraction(damage.target.id, damage.target.name, actor.name + " (" + relation + ") damaged you for " + damage.damage + " with `" + record.action.tool + "`; estimated HP after queued damage " + damage.estimatedHealthAfterQueuedDamage + ".");
            }

            var explosions = record.explosions || [];
            for (var e = 0; e < explosions.length; e++)
            {
                var explosion = explosions[e];
                for (var t = 0; t < targets.length; t++)
                {
                    var target = targets[t];
                    var distance = this.distancePixels(explosion, target);
                    var threshold = Math.max(260, Math.round((explosion.radius || 70) * 4));
                    if (distance > threshold)
                    {
                        continue;
                    }
                    var nearRelation = this.relationToTarget(actor, target);
                    this.appendInteraction(target.id, target.name, actor.name + " (" + nearRelation + ") caused an explosion " + distance + " px from you at (" + explosion.x + ", " + explosion.y + "), radius " + explosion.radius + ".");
                }
            }
        }
    }

    wait(ms, turnContext, observeAfterGameEnded)
    {
        var start = Date.now();
        return new Promise((resolve) =>
        {
            var tick = () =>
            {
                this.watchActiveAiTurn();
                if (turnContext && turnContext.timedOut)
                {
                    resolve(null);
                    return;
                }

                if (turnContext && turnContext.endedByGame && !observeAfterGameEnded)
                {
                    resolve(null);
                    return;
                }

                if (Date.now() - start >= ms)
                {
                    resolve(null);
                    return;
                }

                setTimeout(tick, Math.min(100, ms));
            };
            tick();
        });
    }

    ensureOverlay()
    {
        if (this.overlay)
        {
            return;
        }

        this.overlay = document.createElement("div");
        this.overlay.id = "arenaAgentOverlay";
        this.overlay.style.position = "absolute";
        this.overlay.style.right = "12px";
        this.overlay.style.top = "12px";
        this.overlay.style.width = "360px";
        this.overlay.style.maxHeight = "46vh";
        this.overlay.style.overflow = "hidden";
        this.overlay.style.background = "rgba(10, 10, 14, 0.78)";
        this.overlay.style.border = "1px solid rgba(255,255,255,0.55)";
        this.overlay.style.color = "#f4f4f4";
        this.overlay.style.font = "12px Sans-Serif";
        this.overlay.style.zIndex = "20";
        this.overlay.style.padding = "8px";

        var title = document.createElement("div");
        title.innerHTML = "<strong>LLM Worms Arena</strong>";
        title.style.marginBottom = "6px";
        this.overlay.appendChild(title);

        this.logEl = document.createElement("div");
        this.logEl.style.maxHeight = "40vh";
        this.logEl.style.overflowY = "auto";
        this.overlay.appendChild(this.logEl);

        document.body.appendChild(this.overlay);
    }

    addLog(speaker, text)
    {
        this.appendChatHistory(speaker, text);
        this.ensureOverlay();
        var speakerLabel = typeof speaker == "string" ? speaker : speaker.wormName;
        var teamColor = typeof speaker == "string" ? "#f4f4f4" : speaker.teamColor;
        var row = document.createElement("div");
        row.style.borderTop = "1px solid rgba(255,255,255,0.15)";
        row.style.padding = "5px 0";
        row.innerHTML = "<strong style=\"color:" + this.escapeHtml(teamColor) + "\">" + this.escapeHtml(speakerLabel) + "</strong>: " + this.escapeHtml(text);
        this.logEl.appendChild(row);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    logAgentRequest(requestId, config, payload)
    {
        var screenshotInfo = null;
        if (payload.screenshotDataUrl)
        {
            screenshotInfo = {
                prefix: payload.screenshotDataUrl.split(",")[0],
                chars: payload.screenshotDataUrl.length
            };
        }

        var eventPayload = {
            requestId: requestId,
            endpoint: Settings.ARENA_AGENT_ENDPOINT,
            config: config,
            payload: {
                requestId: payload.requestId,
                matchId: payload.matchId,
                turnId: payload.turnId,
                teamIndex: payload.teamIndex,
                teamName: payload.teamName,
                personality: payload.personality,
                wormId: payload.wormId,
                wormName: payload.wormName,
                wormProfileMarkdown: payload.wormProfileMarkdown,
                wormMemoryMarkdown: payload.wormMemoryMarkdown,
                chatHistoryMarkdown: payload.chatHistoryMarkdown,
                interactionInboxMarkdown: payload.interactionInboxMarkdown,
                memoryStrategy: payload.memoryStrategy,
                memoryWindow: payload.memoryWindow,
                model: payload.model,
                perception: payload.perception,
                chatLanguage: payload.chatLanguage,
                feedbackMarkdown: payload.feedbackMarkdown,
                snapshotMarkdown: payload.snapshotMarkdown,
                visionError: payload.visionError,
                screenshot: screenshotInfo,
                screenshotDataUrl: payload.screenshotDataUrl
            }
        };
        this.debug("agent/request", eventPayload);
        this.postAgentEvent("agent-request", eventPayload);
    }

    postAgentEvent(label, payload)
    {
        if (!Settings.ARENA_AGENT_ENDPOINT)
        {
            return;
        }

        try
        {
            var endpoint = Settings.ARENA_AGENT_ENDPOINT.replace(/\/agent\/turn$/, "/agent/event");
            fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId: "browser-event-" + Date.now(),
                    label: label,
                    payload: payload
                })
            }).catch((error) =>
            {
                this.debug("agent/event-error", {
                    label: label,
                    errorMessage: error.message
                });
            });
        } catch (e)
        {
            this.debug("agent/event-error", {
                label: label,
                errorMessage: e.message
            });
        }
    }

    debug(label, value)
    {
        if (typeof console == "undefined" || !console.log)
        {
            return;
        }

        var rendered = this.formatDebugValue(value);
        console.log("[Arena] " + label + "\n" + rendered);
    }

    formatDebugValue(value)
    {
        if (typeof value == "string")
        {
            return value;
        }

        try
        {
            return JSON.stringify(value, null, 2);
        } catch (e)
        {
            return String(value);
        }
    }

    escapeHtml(value)
    {
        return String(value).replace(/[&<>'"]/g, function (char)
        {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "'": "&#39;",
                "\"": "&quot;"
            }[char];
        });
    }
}
