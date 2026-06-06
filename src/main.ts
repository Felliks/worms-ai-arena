/**
 *  
 * Worms Armageddon HTML5 Clone 
 *
 * Main entry piont
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="Game.ts"/>
///<reference path="system/Graphics.ts"/>
///<reference path="gui/StartMenu.ts" />
///<reference path="llm/ArenaController.ts" />
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

                GameInstance.step();
                GameInstance.update();
                ArenaControllerInstance.update();
                GameInstance.draw();
                window.requestAnimationFrame(gameloop);
            }
            gameloop();

        });
    }

});