/**
 * @author Timur Kuzhagaliyev <tim.kuzh@gmail.com>
 * @copyright 2019
 * @license LGPL-3.0
 */

const path = require('path');

const config = require('./config');
const Logger = require('./lib/Logger');
const BouncerBot = require('./lib/BouncerBot');

const dataDir = path.join(__dirname, 'data');
const bot = new BouncerBot({...config, dataDir});

bot.start()
    .catch(error => Logger.error(error));
