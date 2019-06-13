/**
 * @author Timur Kuzhagaliyev <tim.kuzh@gmail.com>
 * @copyright 2019
 * @license LGPL-3.0
 */

const _ = require('lodash');
const path = require('path');
const Denque = require('denque');
const shortid = require('shortid');
const Promise = require('bluebird');
const Discord = require('discord.js');
const ExactTrie = require('exact-trie');

const Util = require('./Util');
const Server = require('./Server');
const JsonDictionary = require('./JsonDictionary');

const logger = Util.getLogger();

let botToken;

/**
 * @typedef Suspect
 * @property {string} id
 * @property {object} flags
 * @property {User} user
 */


class BouncerBot {

    /**
     * @param {object} data
     * @param {string} data.token Discord bot token.
     * @param {string} data.host
     * @param {number} data.port
     * @param {object} data.recaptcha
     * @param {string} data.recaptcha.siteKey
     * @param {string} data.recaptcha.secretKey
     * @param {string} data.dataDir Folder in which JSON data will be stored.
     */
    constructor(data) {
        botToken = data.token;
        this._dataDir = data.dataDir;
        this._baseUrl = `${data.host}:${data.port}`;

        this._commandPrefix = '!bb';
        this._client = new Discord.Client();
        this._server = new Server({bot: this, port: data.port, recaptcha: data.recaptcha});

        this._verificationDict = new JsonDictionary({path: path.join(this._dataDir, 'verification.json')});
        this._whitelistDict = new JsonDictionary({path: path.join(this._dataDir, 'whitelist.json')});

        /**
         * @type {{[string]: Suspect[]}}
         * @private
         */
        this._guildSuspectMap = {};

        this._setupCommands();
        this._setupDiscordJs();
    }

    _setupCommands() {
        const guildCommandHandlerMap = {
            'ping': ({message}) => message.reply('pong!'),
            'prepare': ({message, params}) => this._prepareList({guild: message.guild, message, params}),
            'list': ({message}) => this._showList({message}),
            'spare': ({message, params}) => this._spare({message, params}),
            'kick': ({message}) => this._kick({message}),
        };
        this._guildCommandTrie = new ExactTrie();
        for (const subCommand in guildCommandHandlerMap) {
            this._guildCommandTrie.put(`${subCommand}`, guildCommandHandlerMap[subCommand]);
        }

        const dmCommandHandlerMap = {
            'ping': this._guildSuspectMap['ping'],
            'verify': ({message, params}) => this._attemptVerification({message, params}),
        };
        this._dmCommandTrie = new ExactTrie();
        for (const subCommand in dmCommandHandlerMap) {
            this._dmCommandTrie.put(`${subCommand}`, dmCommandHandlerMap[subCommand]);
        }
    }

    _setupDiscordJs() {
        const client = this._client;

        client.on('ready', () => {
            logger.info(`Bot logged in as ${client.user.tag}!`);
            // this._prepareList({guild: client.guilds.array()[0]});
        });

        client.on('guildMemberAdd', member => {
            Promise.resolve()
                .then(() => this._processNewMember(member))
                .catch(error => logger.error('An error occurred while processing new member:\n', error));
        });

        client.on('message', /** @param {Message} message */message => {
            const content = message.content;
            if (!content.startsWith(this._commandPrefix)) return;

            const command = content.substring(this._commandPrefix.length).trim();

            let handler;
            if (message.guild) handler = this._guildCommandTrie.getWithCheckpoints(command, ' ');
            else handler = this._dmCommandTrie.getWithCheckpoints(command, ' ');

            if (handler) {
                const params = command.split(' ');
                Promise.resolve()
                    .then(() => handler({message, params}))
                    // .then(() => message.react('👌'))
                    .catch(error =>
                        message.reply(`an error occurred while fulfilling your request: \`${error.message}\``))
                ;
            }
        });
    }

    /**
     * @param {GuildMember} member
     * @private
     */
    _processNewMember(member) {
        return Promise.resolve()
            .then(() => member.guild.fetchMember(member.user))
            .then(guildMember => {
                const user = guildMember.user;
                const flags = Util.computeUserFlags(user);
                const score = Util.computeScoreFromFlags(flags);
                if (score < 3) return;

                return this._banWithVerification(guildMember);
            });
    }

    /**
     * @param {GuildMember} member
     * @private
     */
    _banWithVerification(member) {
        const {guild, user} = member;
        if (user.id !== '588490857603268619') return;

        logger.info(`Banning user "${user.tag}"!`);
        const banId = shortid.generate();

        return Promise.resolve()
            .then(() => user.createDM())
            .then(dmChannel => {
                this._verificationDict.put(banId, {
                    banId,
                    userTag: user.tag,
                    userId: user.id,
                    guildId: guild.id,
                    date: new Date().getTime(),
                });

                // const banPromise = guild.ban(user, {days: 1, reason: 'You triggered too many security flags.'});

                let banMessage = `You were banned from *${guild.name}* server for setting off too many security flags.`;
                banMessage += ` The ban will be lifted if you verify yourself on this page:\n\n`;
                banMessage += `${this._baseUrl}/verify/${banId}`;
                return Promise.resolve()
                    .then(() => dmChannel.send(banMessage))
                    // .then(() => guild.ban(user, {days: 2, reason: 'You triggered too many security flags.'}));
                    .then(() => member.kick('You triggered too many security flags.'));
            });
    }

    /**
     * @param {object} data
     * @param {Message} data.message Message that triggered the command.
     * @param {string[]} [data.params] Command params
     * @private
     */
    _attemptVerification(data) {
        const {message, params} = data;
        const user = message.author;
        const channel = message.channel;

        const details = this._verificationDict.get(user.id);
        if (!details) return channel.send('You are not currently undergoing a verification process.');
        if (!params || params.length <= 1) return channel.send('You didn\'t type in the verification code.');

        if (details.verificationCode !== params[1]) return channel.send('Incorrect verification code.');

        const guild = this._client.guilds.get(details.guildId);
        if (!guild) return channel.send('The guild you were banned from is not available.');

        return Promise.resolve()
            .then(() => guild.fetchMember(user))
            .then(member => {
                if (!member) return channel.send('You are not a member of the server you were banned from.');

                logger.info(`Unmuting user "${user.tag}"!`);
                this._verificationDict.delete(user.id);
                this._whitelistDict.put(user.id, true);
                return Promise.resolve()
                    .then(() => member.setMute(false, 'You verified your account.'))
                    .then(() => channel.send('You successfully verified your account, your ban has been lifted.'));
            });
    }

    /**
     * @param {object} data
     * @param {Guild} data.guild Guild based on which the list will be prepared.
     * @param {Message} [data.message] Message that triggered the command.
     * @param {string[]} [data.params] Command params
     * @private
     */
    _prepareList(data = {}) {
        const {guild, message, params} = data;
        const suspectQueue = new Denque();

        let threshold = 3;
        if (params && params.length >= 2) threshold = +params[1];

        logger.info(`Prepping list for guild "${guild.name}" with threshold ${threshold}. (params: ${JSON.stringify(params)})`);
        return Promise.resolve()
            .then(() => guild.fetchMembers())
            .then(() => {
                const members = guild.members.array();
                const potentialSpambots = members.filter(m => Util.isSpamBotName(m.user.username));
                const potentialSpambotUserIds = potentialSpambots.map(m => m.user.id);
                const userPromises = potentialSpambotUserIds.map(id => this._client.fetchUser(id));
                return Promise.all(userPromises);
            })
            .then(users => {
                users.sort((A, B) => A.username.localeCompare(B.username));
                // console.log(users.map(u => u.username));
                for (const user of users) {
                    const flags = Util.computeUserFlags(user);
                    const score = Util.computeScoreFromFlags(flags);
                    if (score >= threshold) {
                        suspectQueue.push({
                            id: user.id,
                            flags,
                            score,
                            user,
                        });
                    }
                }

                this._guildSuspectMap[guild.id] = suspectQueue.toArray();
                if (message) return message.channel.send(`Prepared suspect list with score threshold ${threshold}.`);
            })
            .then(() => {
                if (message) return this._showList({message});
            });
    }

    /**
     * @param {object} data
     * @param {Message} data.message Message that triggered the command.
     * @param {string[]} data.params Command params
     * @private
     */
    _spare(data) {
        const {message, params} = data;
        if (!params || params.length <= 1) return;

        const suspects = this._guildSuspectMap[message.channel.guild.id];
        if (!suspects || suspects.length === 0) {
            message.reply(`the suspect list is empty. use \`${this._commandPrefix} prepare\` to initialise the list.`);
            return;
        }

        const indicesString = params.slice(1).join('').replace(/\s+/g, '');
        const indices = indicesString.split(',').map(s => +s).filter(n => !isNaN(n));
        _.pullAt(suspects, indices);

        if (message) return this._showList({message});
    }

    /**
     * @param {object} data
     * @param {Message} data.message Message that triggered the command.
     * @private
     */
    _kick(data) {
        const {message} = data;
        const channel = message.channel;
        const guild = channel.guild;

        const suspects = this._guildSuspectMap[guild.id];
        if (!suspects || suspects.length === 0) {
            message.reply(`the suspect list is empty. use \`${this._commandPrefix} prepare\` to initialise the list.`);
            return;
        }

        const memberPromises = suspects.map(s => guild.fetchMember(s.user));
        return Promise.all(memberPromises)
            .then(members => Promise.all(members.map(m => m.kick('You set off too many security flags.'))))
            .then(() => channel.send(`Kicked ${suspects.length} members.`));
    }

    /**
     * @param {object} data
     * @param {Message} data.message Message that triggered the command.
     * @private
     */
    _showList(data) {
        const {message} = data;
        const channel = message.channel;

        const suspects = this._guildSuspectMap[message.channel.guild.id];
        if (!suspects || suspects.length === 0) {
            message.reply(`the suspect list is empty. use \`${this._commandPrefix} prepare\` to initialise the list.`);
            return;
        }

        const count = suspects.length;
        let messageString = count === 1 ? `There is ${count} suspect:\n` : `There are ${count} suspects:\n`;
        messageString += '```asciidoc\n';
        const avatarList = new Array(suspects.length);
        for (let i = 0; i < suspects.length; ++i) {
            const {user, flags, score} = suspects[i];


            let flagString;
            const flagStrings = Util.convertFlagsToStrings(flags);
            if (flagStrings.length === 0) flagString = 'No flags.\n';
            else flagString = `[${flagStrings.join('] [')}]\n`;

            if (i !== 0) messageString += '\n';
            messageString += `= ${i}: ${user.tag} (score: ${score})\n`;
            messageString += flagString;

            avatarList[i] = {
                text: user.tag,
                url: user.displayAvatarURL,
            };
        }
        messageString += '```\n';

        return Promise.all([Util.combineAvatarsIntoImage(avatarList), channel.send(messageString)])
            .then(([avatarImage, _]) => channel.send({files: [avatarImage]}));
    }

    start() {
        return this._client.login(botToken);
    }

}

module.exports = BouncerBot;
