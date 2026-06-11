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
    sameTurnResumeTimer;

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
        this.sameTurnResumeTimer = null;
    }

    isEnabled()
    {
        return this.enabled;
    }

    // The resolved menu config (names, colours, personas, connection cascade),
    // or null for the legacy ?arena= URL launch path.
    getRuntime()
    {
        if (typeof ArenaConfig != "undefined" && ArenaConfig.runtime)
        {
            return ArenaConfig.runtime;
        }
        // ?arena= URL auto-start has no menu config: seed a default runtime from the built-in
        // roster so team/worm names, personas, and colors come from DEFAULT_TEAMS rather than the
        // engine's default human names.
        if (typeof ArenaConfig != "undefined" && ArenaConfig.buildDefaultRuntime)
        {
            if (!this.defaultRuntime)
            {
                var count = (Settings.ARENA_TEAM_TYPES && Settings.ARENA_TEAM_TYPES.length > 0) ? Settings.ARENA_TEAM_TYPES.length : 2;
                this.defaultRuntime = ArenaConfig.buildDefaultRuntime(count, Settings.ARENA_CHAT_LANGUAGE);
            }
            return this.defaultRuntime;
        }
        return null;
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
        var turnKey = this.aiPhysicalTurnKey(player, worm);
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
        var turnKey = physicalTurnKey || this.aiPhysicalTurnKey(player, worm);
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
            maxSameTurnBatches: Settings.ARENA_MAX_BATCHES_PER_TURN,
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
                if (!response.ok)
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
                        throw new Error("HTTP " + response.status + " from " + Settings.ARENA_AGENT_ENDPOINT + ": " + text);
                    });
                }
                return this.consumeDecisionStream(response, requestId, turnContext);
            })
            .then((decision) =>
            {
                if (!decision)
                {
                    return;
                }
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
        // The thinking-phase thought bubble vanishes the moment the worm starts acting.
        this.hideThoughtBubble();
        // Record the final trash talk in the shared chat history (so other worms can clap back).
        // The streamed bubble is visual only; this is the single canonical history entry.
        var talker = this.game.state.getCurrentPlayer();
        if (decision.trashTalk && talker)
        {
            var talkTeam = talker.getTeam();
            var talkWorm = talkTeam.getCurrentWorm();
            this.appendChatHistory({
                wormName: talkWorm ? talkWorm.name : turnContext.wormName,
                teamName: talkTeam.name,
                teamColor: talkTeam.color
            }, decision.trashTalk);
        }
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
                if (shouldContinueSameAiTurn && turnContext.sameTurnBatch >= Settings.ARENA_MAX_BATCHES_PER_TURN)
                {
                    this.previousFeedback += "\n- Same-worm AI batch limit reached (" + Settings.ARENA_MAX_BATCHES_PER_TURN + "); ending this worm turn to prevent action-loop stalls.\n";
                    this.postAgentEvent("agent/max-batches-per-turn", {
                        playerIndex: turnContext.playerIndex,
                        wormName: turnContext.wormName,
                        turnNumber: turnContext.turnNumber,
                        sameTurnBatch: turnContext.sameTurnBatch,
                        maxSameTurnBatches: Settings.ARENA_MAX_BATCHES_PER_TURN
                    });
                    this.clearAiTurn(turnContext);
                    this.busy = false;
                    this.game.state.timerTiggerNextTurn();
                    return;
                }
                if (shouldContinueSameAiTurn)
                {
                    var continuePayload = {
                        playerIndex: turnContext.playerIndex,
                        wormName: turnContext.wormName,
                        turnNumber: turnContext.turnNumber,
                        sameTurnBatch: turnContext.sameTurnBatch,
                        turnTimeRemainingMs: this.physicalTurnRemainingMs(turnContext.physicalTurnKey),
                        reason: "Action batch did not end the game turn; requesting another AI decision with fresh feedback. Fresh same-turn VLM screenshot will be captured in runAiTurn."
                    };
                    this.debug("agent/continue-same-turn", continuePayload);
                    this.postAgentEvent("agent/continue-same-turn", continuePayload);
                    this.clearAiTurn(turnContext);
                    this.scheduleSameTurnAiContinuation(config, turnContext);
                    return;
                }
                this.clearAiTurn(turnContext);
                this.busy = false;
            })
            .catch((err) =>
            {
                // An unexpected engine throw mid-batch would otherwise leave busy=true
                // until the turn watchdog fires (a multi-second visible freeze). Log it
                // and recover immediately by advancing the turn.
                turnContext.executingActions = false;
                var errorPayload = {
                    playerIndex: turnContext.playerIndex,
                    wormName: turnContext.wormName,
                    turnNumber: turnContext.turnNumber,
                    errorMessage: (err && err.message) ? err.message : String(err)
                };
                this.debug("agent/execute-error", errorPayload);
                this.postAgentEvent("agent/execute-error", errorPayload);
                this.clearAiTurn(turnContext);
                this.busy = false;
                if (!turnContext.timedOut)
                {
                    this.game.state.timerTiggerNextTurn();
                }
            });
    }

    scheduleSameTurnAiContinuation(config, turnContext)
    {
        if (this.sameTurnResumeTimer)
        {
            clearTimeout(this.sameTurnResumeTimer);
            this.sameTurnResumeTimer = null;
        }

        this.busy = true;
        var resume = () =>
        {
            this.sameTurnResumeTimer = null;
            if (!this.isAiTurnCurrent(turnContext))
            {
                this.busy = false;
                return;
            }

            if (!this.game.state.physicsWorldSettled || this.game.state.hasNextTurnBeenTiggered())
            {
                var waitPayload = {
                    playerIndex: turnContext.playerIndex,
                    wormName: turnContext.wormName,
                    turnNumber: turnContext.turnNumber,
                    sameTurnBatch: turnContext.sameTurnBatch,
                    turnTimeRemainingMs: this.physicalTurnRemainingMs(turnContext.physicalTurnKey),
                    reason: "Waiting for render/physics settle before fresh VLM screenshot."
                };
                this.debug("agent/continue-same-turn/wait-settle", waitPayload);
                this.postAgentEvent("agent/continue-same-turn/wait-settle", waitPayload);
                this.sameTurnResumeTimer = setTimeout(resume, 250);
                return;
            }

            var resumePayload = {
                playerIndex: turnContext.playerIndex,
                wormName: turnContext.wormName,
                previousTurnNumber: turnContext.turnNumber,
                previousSameTurnBatch: turnContext.sameTurnBatch,
                nextSameTurnBatch: (this.sameTurnBatchCounts[turnContext.physicalTurnKey] || 0) + 1,
                turnTimeRemainingMs: this.physicalTurnRemainingMs(turnContext.physicalTurnKey),
                reason: "Fresh same-turn VLM screenshot will be captured in runAiTurn."
            };
            this.debug("agent/continue-same-turn/resume", resumePayload);
            this.postAgentEvent("agent/continue-same-turn/resume", resumePayload);
            this.runAiTurn(turnContext.playerIndex, config, turnContext.physicalTurnKey);
        };

        this.sameTurnResumeTimer = setTimeout(resume, 250);
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
            // Avoid echoing a line the streaming early-say already rendered for this worm-turn.
            var sayText = action.text || "";
            var sameAsEarly = turnContext.earlySayShown && String(sayText).trim().toLowerCase() == turnContext.earlySayShown;
            if (!sameAsEarly)
            {
                this.addLog({
                    wormName: worm.name,
                    teamName: player.getTeam().name,
                    teamColor: player.getTeam().color
                }, sayText);
            }
            ArenaTelemetry.addNote("Said: " + sayText);
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

        if (tool == "teleport")
        {
            this.attemptTeleport(player, worm, action.x, action.y);
            return this.wait(450, turnContext).then(() => ArenaTelemetry.finishAction());
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
            // Capture the shot inputs (power %, aim) before firing, since fire can reset the
            // force meter. This is fed back so the agent can compare its formula prediction
            // against the actual result and calibrate next turn.
            var preFireWeapon = worm.getWeapon();
            var shotSummary = (typeof ArenaSnapshot != "undefined" && ArenaSnapshot.shotInputSummary)
                ? ArenaSnapshot.shotInputSummary(preFireWeapon, worm)
                : "";
            worm.fire();
            var firedWeapon = worm.getWeapon();
            var fireProfile = this.weaponObserveProfile(firedWeapon);
            ArenaTelemetry.addNote("Fire requested with " + (firedWeapon ? firedWeapon.name : "weapon") + ".");
            if (shotSummary)
            {
                ArenaTelemetry.addNote(shotSummary);
            }
            var observeMs = fireProfile.ballistic ? Math.max(action.observeMs || 0, fireProfile.observeMs) : (action.observeMs || fireProfile.observeMs);
            return this.observeShot(firedWeapon, observeMs, turnContext).then(() =>
            {
                // currentAction stays open across the whole observation window, so a late fuse
                // detonation is still recorded. If a ballistic weapon resolved with no explosion,
                // it left the play area - say so instead of "still resolving".
                var record = ArenaTelemetry.currentAction;
                if (record && fireProfile.ballistic && record.explosions.length == 0 && record.damage.length == 0)
                {
                    ArenaTelemetry.addNote("No detonation was observed within " + observeMs + " ms; the projectile most likely left the play area (off-map or into water) without contact. This is a real miss, not a timing artifact.");
                }
                return ArenaTelemetry.finishAction();
            });
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
            var requested = list[selected];
            manager.setCurrentWeapon(selected);
            GameInstance.weaponMenu.refresh();
            // The engine silently refuses to switch while the current weapon is still active, so
            // confirm the switch actually took effect instead of reporting the request as success.
            var active = manager.getCurrentWeapon ? manager.getCurrentWeapon() : requested;
            if (active === requested || (active && requested && active.name == requested.name))
            {
                ArenaTelemetry.addNote("Selected weapon `" + requested.name + "`, ammo " + requested.ammo + ".");
                ArenaTelemetry.addNote(this.weaponUseGuidance(requested));
                if (typeof requested.ammo == "number" && requested.ammo <= 0)
                {
                    ArenaTelemetry.addNote("Warning: `" + requested.name + "` has 0 ammo; firing it will do nothing. Pick a weapon that still has ammo.");
                }
                return requested;
            }
            ArenaTelemetry.addNote("Weapon switch to `" + requested.name + "` was rejected: `" + (active ? active.name : "the current weapon") + "` is still active. Stop or observe the active weapon first, then reselect. A fire now would use `" + (active ? active.name : "the current weapon") + "`, not `" + requested.name + "`.");
            return active || null;
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

    weaponObserveProfile(weapon)
    {
        // Weapon-aware observation window so the feedback wait outlasts the projectile's fuse +
        // flight. The old flat 5200 ms hid grenade detonations entirely (Holy Grenade fuse alone
        // is 6000 ms). ballistic=false marks instant ray weapons that resolve on the same frame.
        var name = weapon && weapon.name ? String(weapon.name).toLowerCase() : "";
        if (name.indexOf("holy") >= 0)
        {
            return { observeMs: 8500, ballistic: true };
        }
        if (name.indexOf("banana") >= 0)
        {
            return { observeMs: 9000, ballistic: true };
        }
        if (name.indexOf("cluster") >= 0)
        {
            return { observeMs: 7800, ballistic: true };
        }
        if (name.indexOf("grenade") >= 0)
        {
            return { observeMs: 6500, ballistic: true };
        }
        if (name.indexOf("dynamite") >= 0)
        {
            return { observeMs: 6500, ballistic: true };
        }
        if (name.indexOf("mortar") >= 0)
        {
            return { observeMs: 7600, ballistic: true };
        }
        if (name.indexOf("bazooka") >= 0 || name.indexOf("missile") >= 0)
        {
            return { observeMs: 6500, ballistic: true };
        }
        if (name.indexOf("blowtorch") >= 0)
        {
            return { observeMs: 5600, ballistic: false };
        }
        if (name.indexOf("baseball") >= 0 || name.indexOf("prod") >= 0 || name.indexOf("fire punch") >= 0 || name.indexOf("dragon ball") >= 0)
        {
            return { observeMs: 1400, ballistic: false };
        }
        if (name.indexOf("shotgun") >= 0)
        {
            return { observeMs: 1500, ballistic: false };
        }
        if (name.indexOf("minigun") >= 0 || name.indexOf("uzi") >= 0 || name.indexOf("handgun") >= 0)
        {
            return { observeMs: 2200, ballistic: false };
        }
        return { observeMs: 5200, ballistic: false };
    }

    observeShot(weapon, observeMs, turnContext)
    {
        // Poll until the fired weapon resolves (detonated/cleaned up) rather than one fixed wait,
        // so a contact hit ends early while a long fuse is still observed in full. The window is
        // never cut before minWindow and is hard-capped by ceiling.
        var ceiling = Math.max(observeMs, 9500);
        var minWindow = Math.min(observeMs, 1200);
        var start = Date.now();
        var poll = () =>
        {
            var elapsed = Date.now() - start;
            var live = !!(weapon && weapon.getIsActive && weapon.getIsActive());
            if (elapsed >= ceiling)
            {
                return Promise.resolve(null);
            }
            if (!live && elapsed >= minWindow)
            {
                return Promise.resolve(null);
            }
            return this.wait(150, turnContext, true).then(poll);
        };
        return poll();
    }

    aiPhysicalTurnKey(player, worm)
    {
        return "turn-" + this.game.state.getPhysicalTurnSerial() + ":" + player.id + ":" + worm.name + ":" + player.getTeam().currentWorm;
    }

    positionNote(worm)
    {
        var pos = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
        return "(" + Math.round(pos.x) + ", " + Math.round(pos.y) + ")";
    }

    attemptTeleport(player, worm, x, y)
    {
        var weapon = this.ensureWeapon(player, "Teleport");
        if (!weapon)
        {
            ArenaTelemetry.addNote("Teleport rejected: Teleport weapon was not found.");
            return null;
        }
        if (!weapon.attemptTeleport)
        {
            ArenaTelemetry.addNote("Teleport rejected: current Teleport weapon cannot validate destinations.");
            return null;
        }
        var result = weapon.attemptTeleport(worm, x, y);
        if (result && result.ok)
        {
            ArenaTelemetry.addNote("Teleport succeeded: " + result.reason);
        } else
        {
            ArenaTelemetry.addNote("Teleport rejected: " + (result ? result.reason : "unknown rejection") + ".");
        }
        if (GameInstance.weaponMenu)
        {
            GameInstance.weaponMenu.refresh();
        }
        return result;
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
        var startVec = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
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
            var endVec = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
            var moved = Math.round(Math.sqrt(Math.pow(endVec.x - startVec.x, 2) + Math.pow(endVec.y - startVec.y, 2)));
            var fuelUsed = startFuel - Math.round(weapon.fuel || 0);
            ArenaTelemetry.addNote("Jet Pack thrust `" + dir + "` for " + duration + " ms. Start " + startPos + ", end " + this.positionNote(worm) + ", fuel " + startFuel + " -> " + Math.round(weapon.fuel || 0) + ".");
            if (moved < 8 && fuelUsed > 0)
            {
                ArenaTelemetry.addNote("Jet Pack moved only " + moved + " px while burning " + fuelUsed + " fuel: you are blocked against the `" + dir + "` direction (ceiling/wall). Change thrust direction or stop; repeating this direction wastes fuel and ammo for no movement.");
            }
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
        // Only trust the anchor when the rope actually attached; on a miss the engine leaves a
        // stale anchor from a previous fire, which would otherwise look like a successful hook.
        var anchor = active && weapon.anchor ? Physics.vectorMetersToPixels(weapon.anchor.GetPosition().Copy()) : null;
        if (active)
        {
            ArenaTelemetry.addNote("Ninja Rope fired; active true" + (anchor ? ", anchor (" + Math.round(anchor.x) + ", " + Math.round(anchor.y) + ")" : "") + ".");
        } else
        {
            ArenaTelemetry.addNote("Ninja Rope hook missed: the aim ray found no terrain within range, so the rope did not attach. Any rope_contract/rope_swing/rope_release later in this same batch cannot act on it. Re-aim at solid terrain (a wall or ceiling within ~900 px) before firing the rope again.");
        }
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
        worm.target.setAimDegrees(bounded);
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
            return /Explosion at|Explosion relative|relative to `|Miss feedback|SELF DAMAGE|FRIENDLY FIRE|ENEMY HIT|Damage summary|Safety lesson|Shot produced no recorded|Voluntarily ended|Walked|Selected weapon|Teleport rejected|Teleport succeeded|Set aim|Set force|Fire requested|Said:/.test(line);
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
            if (action.tool == "teleport" && action.x != null && action.y != null)
            {
                parts.push("to (" + Math.round(action.x) + "," + Math.round(action.y) + ")");
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

    // No chat panel: the worm's line is shown as a thought bubble over its head (Worms-style).
    // ensureOverlay now lazily builds that single reusable bubble element.
    ensureOverlay()
    {
        if (this.bubbleEl)
        {
            return;
        }
        var el = document.createElement("div");
        el.id = "arenaThoughtBubble";
        el.className = "wa-bubble";
        el.style.display = "none";

        // No name inside the bubble: the worm already has its name label below it.
        var txt = document.createElement("div");
        txt.className = "wa-bubble-text";
        var tail = document.createElement("div");
        tail.className = "wa-bubble-tail";

        el.appendChild(txt);
        el.appendChild(tail);
        document.body.appendChild(el);
        this.bubbleEl = el;
    }

    // Chat history is kept for the prompt (shared chat + clap-backs); nothing is rendered to a panel.
    addLog(speaker, text)
    {
        this.appendChatHistory(speaker, text);
    }

    // Show/refresh the worm's line as a thought bubble above the active worm while it thinks.
    // Called repeatedly as the line streams in - the text updates live; the fade-in plays once.
    showThoughtBubble(turnContext, text)
    {
        if (!this.isAiTurnCurrent(turnContext))
        {
            return;
        }
        var player = this.game.state.getCurrentPlayer();
        if (!player)
        {
            return;
        }
        var team = player.getTeam();
        var worm = team.getCurrentWorm();
        turnContext.earlySayShown = String(text).trim().toLowerCase();

        this.ensureOverlay();
        var wasHidden = this.bubbleEl.style.display == "none";
        this.bubbleWorm = worm;
        this.bubbleEl.style.borderColor = team.color;
        // The streamed text is the typewriter TARGET; the client reveals it character by character.
        this.bubbleTargetText = String(text);

        if (wasHidden)
        {
            this.bubbleShownChars = 0;
            this.bubbleEl.querySelector(".wa-bubble-text").textContent = "";
            this.bubbleEl.style.display = "block";
            this.bubbleEl.classList.remove("wa-bubble-in");
            void this.bubbleEl.offsetWidth;
            this.bubbleEl.classList.add("wa-bubble-in");
        }

        this.startTypewriter();
        this.positionBubble();
        this.startBubbleTracking();
    }

    // Reveal the bubble text one character at a time toward the latest streamed target, easing out
    // as it catches up. Restarts whenever a new (longer) chunk extends the target.
    startTypewriter()
    {
        if (this.typewriterTimer)
        {
            return;
        }
        var self = this;
        var step = function ()
        {
            self.typewriterTimer = null;
            if (!self.bubbleEl || self.bubbleEl.style.display == "none")
            {
                return;
            }
            var target = self.bubbleTargetText || "";
            var shown = self.bubbleShownChars || 0;
            if (shown >= target.length)
            {
                return; // caught up; will restart when the target grows
            }
            var advance = Math.max(1, Math.floor((target.length - shown) / 22));
            self.bubbleShownChars = Math.min(target.length, shown + advance);
            self.bubbleEl.querySelector(".wa-bubble-text").textContent = target.slice(0, self.bubbleShownChars);
            self.positionBubble();
            self.typewriterTimer = window.setTimeout(step, 16);
        };
        this.typewriterTimer = window.setTimeout(step, 16);
    }

    startBubbleTracking()
    {
        if (this.bubbleRaf)
        {
            return;
        }
        var self = this;
        var step = function ()
        {
            if (!self.bubbleEl || self.bubbleEl.style.display == "none" || !self.bubbleWorm)
            {
                self.bubbleRaf = null;
                return;
            }
            self.positionBubble();
            self.bubbleRaf = window.requestAnimationFrame(step);
        };
        this.bubbleRaf = window.requestAnimationFrame(step);
    }

    positionBubble()
    {
        var worm = this.bubbleWorm;
        if (!worm || !worm.body || !this.game || !this.game.camera || !this.bubbleEl)
        {
            return;
        }
        var px = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
        var sx = px.x - this.game.camera.getX();
        var sy = px.y - this.game.camera.getY();
        var el = this.bubbleEl;
        var bw = el.offsetWidth;
        var bh = el.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        var left = sx - (bw / 2);
        // Sit clearly ABOVE the worm's name + HP labels, leaving room for the cloud-trail dots.
        var top = sy - bh - 80;
        var below = false;
        if (top < 8)
        {
            // Not enough room above: flip below the worm so it never covers the action.
            top = sy + 58;
            below = true;
        }
        left = Math.max(8, Math.min(vw - bw - 8, left));
        top = Math.max(8, Math.min(vh - bh - 8, top));
        el.style.left = Math.round(left) + "px";
        el.style.top = Math.round(top) + "px";
        if (below)
        {
            el.classList.add("wa-bubble-below");
        } else
        {
            el.classList.remove("wa-bubble-below");
        }
    }

    hideThoughtBubble()
    {
        if (this.bubbleEl)
        {
            this.bubbleEl.style.display = "none";
        }
        this.bubbleWorm = null;
        if (this.bubbleRaf)
        {
            window.cancelAnimationFrame(this.bubbleRaf);
            this.bubbleRaf = null;
        }
        if (this.typewriterTimer)
        {
            window.clearTimeout(this.typewriterTimer);
            this.typewriterTimer = null;
        }
        this.bubbleShownChars = 0;
        this.bubbleTargetText = "";
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
                sameTurnBatch: payload.sameTurnBatch,
                turnTimeRemainingMs: payload.turnTimeRemainingMs,
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

    consumeDecisionStream(response, requestId, turnContext)
    {
        // Read the newline-delimited JSON turn stream: render `say` events immediately so the
        // worm taunts within a couple of seconds, and return the `final` decision once it lands.
        var self = this;
        var fullText = "";
        var finalDecision = null;

        var logResponse = function ()
        {
            var httpPayload = {
                requestId: requestId,
                status: response.status,
                ok: response.ok,
                responseText: fullText
            };
            self.debug("agent/http-response", httpPayload);
            self.postAgentEvent("agent-http-response", httpPayload);
        };

        var handleLine = function (line)
        {
            var trimmed = String(line || "").trim();
            if (!trimmed)
            {
                return;
            }
            var event;
            try
            {
                event = JSON.parse(trimmed);
            } catch (e)
            {
                return;
            }
            if (event.type == "say" && event.text)
            {
                self.showThoughtBubble(turnContext, event.text);
            } else if (event.type == "final")
            {
                finalDecision = event.decision;
            } else if (event.type == "error")
            {
                throw new Error(event.error || "agent stream error");
            }
        };

        var finishDecision = function ()
        {
            logResponse();
            if (!finalDecision)
            {
                throw new Error("Agent response stream ended without final decision");
            }
            return finalDecision;
        };

        // Fallback when the body is not a readable stream (older engines): buffer then split.
        if (!response.body || typeof response.body.getReader != "function")
        {
            return response.text().then(function (text)
            {
                fullText = text;
                var lines = text.split("\n");
                for (var i = 0; i < lines.length; i++)
                {
                    handleLine(lines[i]);
                }
                return finishDecision();
            });
        }

        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";
        var pump = function ()
        {
            return reader.read().then(function (result)
            {
                if (result.value)
                {
                    var chunk = decoder.decode(result.value, { stream: true });
                    fullText += chunk;
                    buffer += chunk;
                    var lines = buffer.split("\n");
                    buffer = lines.pop();
                    for (var i = 0; i < lines.length; i++)
                    {
                        handleLine(lines[i]);
                    }
                }
                if (result.done)
                {
                    if (buffer)
                    {
                        handleLine(buffer);
                        buffer = "";
                    }
                    return finishDecision();
                }
                return pump();
            });
        };
        return pump();
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
        // Server-side event logs (postAgentEvent) always capture the turn; the
        // verbose console mirror is opt-in (?arenaDebug=true) so the public
        // build's devtools console stays clean.
        if (!Settings.ARENA_DEBUG_LOGS || typeof console == "undefined" || !console.log)
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
