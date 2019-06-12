/**
 * @author Timur Kuzhagaliyev <tim.kuzh@gmail.com>
 * @copyright 2019
 * @license LGPL-3.0
 */

const config = require('./config');
const BouncerBot = require('./lib/BouncerBot');

const bot = new BouncerBot({token: config.token});
bot.start();
