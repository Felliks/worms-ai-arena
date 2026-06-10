/**
 *  
 * LLM Worms Arena
 *
 * Main entry point
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="Game.ts"/>
///<reference path="system/Graphics.ts"/>
///<reference path="gui/StartMenu.ts" />
///<reference path="llm/ArenaController.ts" />
///<reference path="video/RecordingAudioBus.ts" />
///<reference path="video/MatchTimeline.ts" />
///<reference path="video/MatchRecorder.ts" />
///<reference path="gui/VideoStudio.ts" />
///<reference path="gui/PauseMenu.ts" />
///<reference path="gui/VideoOverlay.ts" />
///<reference path="video/VideoCapture.ts" />
var GameInstance: Game;
$(document).ready(() => {

    Settings.getSettingsFromUrl();

    if (!Settings.RUN_UNIT_TEST_ONLY)
    {
        var startMenu = new StartMenu();

        GameInstance = new Game();
        ArenaControllerInstance = new ArenaController(GameInstance);
        AssetManager.loadAssets();
        
        startMenu.onGameReady(function ()
        {
            startMenu.hide();
            if (GameInstance.state.isStarted == false)
            {
                GameInstance.start();
                ArenaControllerInstance.start();
            }

            function gameloop()
            {
               if(Settings.DEVELOPMENT_MODE)
                Graphics.stats.update();

                // The VideoStudio menu or the pause menu freezes the match while open.
                var waPaused = (typeof VideoStudio != "undefined" && VideoStudio.isPaused && VideoStudio.isPaused())
                    || (typeof PauseMenu != "undefined" && PauseMenu.isPaused && PauseMenu.isPaused());
                if (!waPaused)
                {
                    GameInstance.step();
                    GameInstance.update();
                    ArenaControllerInstance.update();
                }
                GameInstance.draw();
                // In-game pause button/Esc + clip moment detection (both no-ops until
                // a match is running / being captured).
                if (typeof PauseMenu != "undefined") { try { PauseMenu.tick(); } catch (e) { } }
                if (typeof VideoCapture != "undefined") { try { VideoCapture.tick(); } catch (e) { } }
                window.requestAnimationFrame(gameloop);
            }
            gameloop();

        });
    }

});
