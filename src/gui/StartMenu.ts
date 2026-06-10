/**
 * StartMenu.js
 * This is the first menu the user interacts with
 * allows them to start the game and shows them the controls.
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="../Settings.ts" />
///<reference path="../system/Controls.ts"/>
///<reference path="LobbyMenu.ts"/>
///<reference path="SettingsMenu.ts"/>
///<reference path="MenuAudio.ts"/>
///<reference path="MainMenu.ts"/>
declare var $;

class StartMenu
{
    controlsView;
    settingsMenu: SettingsMenu;
    static callback;

    constructor()
    {
        //TODO gamepad controls
        this.controlsView = '<div style="text-align:center">' +
            ' <p>This is a turn-based artillery deathmatch. Control a team, aim carefully, and use your available weapons to destroy the enemy. <p><br>' +
            '<p><kbd> Space' +
            '</kbd>  <kbd> ' + String.fromCharCode(Controls.walkLeft.keyboard) +
            '</kbd> <kbd> ' + String.fromCharCode(Controls.walkRight.keyboard) +
            '</kbd> - Jump, Left, Right. <br> <br>' +
             ' <kbd>' + String.fromCharCode(Controls.aimUp.keyboard) + '</kbd> ' +
             ' <kbd>' + String.fromCharCode(Controls.aimDown.keyboard) + '</kbd> ' +
             ' - Aim up and down. </p><br>' +
            ' <kbd>' + String.fromCharCode(Controls.toggleWeaponMenu.keyboard) + '</kbd> or right mouse - Weapon Menu. </p><br>' +
            ' <kbd>Enter</kbd> - Fire weapon. </p><p></p><br>' +
            '<a class="btn btn-primary btn-large" id="startLocal" style="text-align:center">Lets play!</a></div>';

        // Front-menu music + themed background (presentation only, asset-pack
        // aware, silent/graceful when the assets are not installed).
        MenuAudio.init();
    }

    hide()
    {
        MenuAudio.stop();
        $('#startMenu').remove();
    }


    onGameReady(callback)
    {

        var _this = this;
        StartMenu.callback = callback;

        // Short, on-theme loading flavour (rotates while assets stream in).
        var loadTips = [
            "Tip: there is no wind here — blame the model, not the breeze.",
            "Tip: high ground wins arguments and artillery duels.",
            "Tip: the Demo bot needs no API key — just hit Play.",
            "Tip: a grenade's fuse does not care about your reasoning chain.",
            "Tip: give a vision model a screenshot and it reads the battlefield.",
            "Tip: never stand next to the dynamite you just placed.",
            "Tip: connect any OpenAI-compatible endpoint from the menu.",
            "Tip: worms drown — plan your knockbacks."
        ];

        if (!Settings.DEVELOPMENT_MODE)
        {
            var tipIdx = 0;
            var tick = 0;
            var loading = setInterval(() =>
            {
                var loaded = AssetManager.getPerAssetsLoaded();
                var pct = Math.max(0, Math.min(100, Math.round(loaded)));
                if (loaded >= 100)
                {
                    clearInterval(loading);
                    $('#notice .wa-load-bar').css('width', '100%');
                    $('#notice .wa-load-pct').text('100%');
                    if (Settings.ARENA_AUTO_START)
                    {
                        callback();
                        return;
                    }
                    // Hand off to the themed main menu.
                    MainMenu.show(callback);
                    return;
                }

                $('#notice .wa-load-bar').css('width', pct + '%');
                $('#notice .wa-load-pct').text(pct + '%');
                if (tick % 6 === 0)
                {
                    $('#notice .wa-load-tip').text(loadTips[tipIdx % loadTips.length]);
                    tipIdx++;
                }
                tick++;
            }, 300);


            $('#startLocal').click(() =>
            {
                if (AssetManager.isReady())
                {
                    $('#startLocal').off('click');
                    AssetManager.getSound("CursorSelect").play();
                    $('.slide').empty();
                    $('.slide').append(this.settingsMenu.getView());
                    this.settingsMenu.bind(() => {
                        AssetManager.getSound("CursorSelect").play();
                        this.controlsMenu(callback);
                    });

                }


            });

            $('#startOnline').click(() =>
            {
                  $('#startOnline').off('click');
                if (AssetManager.isReady())
                {
                    if (GameInstance.lobby.client_init() != false)
                    {
                        $('#notice').empty();
                        GameInstance.lobby.menu.show(callback);
                        AssetManager.getSound("CursorSelect").play();
                    } else
                    {
                        $('#notice').empty();
                        $('#notice').append('<div class="alert alert-error"> <strong> Oh Dear! </strong> Looks like the multiplayer server is down. Try a local game for a while?</div> ');

                    }
                }

            });

            $('#startTutorial').click(() =>
            {
                $('#startTutorial').off('click');
                if (AssetManager.isReady())
                {
                    AssetManager.getSound("CursorSelect").play();

                    //Initalizse the tutorial object so its used in the game
                    GameInstance.tutorial = new Tutorial();

                    _this.controlsMenu(callback);
                }
            });


        } else
        {
            //Development Mode - Just make sure all assets are loaded first
            var loading = setInterval(() =>
            {   
                if (AssetManager.getPerAssetsLoaded() == 100)
                {
                    clearInterval(loading);
                    callback();               
                }
            },2)
        }
    }

    controlsMenu(callback)
    {

        $('.slide').fadeOut('normal', () =>
        {
            $('.slide').empty();
            $('.slide').append(this.controlsView);
            $('.slide').fadeIn('slow');

            $('#startLocal').click(() =>
            {
                $('#startLocal').unbind();
                $('#splashScreen').remove();
                $('#startMenu').fadeOut('normal');
                AssetManager.getSound("CursorSelect").play();
                AssetManager.getSound("StartRound").play(1, 0.5);
                callback();
            })
        });
    }

}
