/**
 * @author Timur Kuzhagaliyev <tim.kuzh@gmail.com>
 * @copyright 2019
 * @license LGPL-3.0
 */

const Discord = require('discord.js');

class BouncerBot {

    /**
     * @param {object} data
     * @param {string} data.token Discord bot token
     */
    constructor(data) {
        this.token = data.token;
    }

    _setupDiscordJs() {
        const client = new Discord.Client();


        this.client = client;
    }

    start() {
        this.client.login(this.token);
    }

}

module.exports = BouncerBot;
