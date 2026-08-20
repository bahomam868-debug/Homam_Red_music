'use strict';

// ======================================================
// RED MUSIC
// Discord.js 14 + DisTube 5
// ======================================================

const express = require('express');

const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const { DisTube } = require('distube');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { YtDlpPlugin } = require('@distube/yt-dlp');


// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;

const PREFIX = '5';

const EMPTY_LEAVE_DELAY = 5 * 60 * 1000; // 5 دقائق
const PANEL_UPDATE_INTERVAL = 10 * 1000; // 10 ثواني


// ======================================================
// ENV CHECK
// ======================================================

if (!TOKEN) {
    console.error('❌ TOKEN environment variable is missing.');
    process.exit(1);
}


// ======================================================
// EXPRESS / RENDER
// ======================================================

const app = express();

app.get('/', (req, res) => {
    res.status(200).send('RED MUSIC Bot is online!');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        bot: client?.user?.tag || null,
        uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log(`🌍 Web server listening on port ${PORT}`);
});


// ======================================================
// CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});


// ======================================================
// DISTUBE
// ======================================================

const distube = new DisTube(client, {
    searchSongs: 1,

    leaveOnEmpty: false,
    leaveOnFinish: false,
    leaveOnStop: false,

    plugins: [
        new SoundCloudPlugin(),

        // يجب أن يكون آخر Plugin
        new YtDlpPlugin({
            update: true
        })
    ]
});


// ======================================================
// MEMORY
// ======================================================

// قناة الرسائل الخاصة بالموسيقى لكل سيرفر
const musicChannels = new Map();

// لوحة التحكم لكل سيرفر
const musicPanels = new Map();

// وضع 24/7
const mode247 = new Map();

// عمليات الخروج اليدوي
const manualLeave = new Set();

// مؤقت الخروج بعد فراغ الروم
const emptyTimers = new Map();

// القوائم المحفوظة
// guildId -> Map(name, { name, songs })
const savedPlaylists = new Map();


// ======================================================
// LOG
// ======================================================

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔴 RED MUSIC');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎵 DisTube Music System');
console.log('🎧 YouTube + SoundCloud');
console.log('🎛️ Music Control Panel');
console.log('⏱️ Empty Voice Timeout: 5 minutes');
console.log('🔴 24/7 System: Enabled');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');


// ======================================================
// HELPERS
// ======================================================

function formatTime(seconds) {
    if (
        seconds === undefined ||
        seconds === null ||
        Number.isNaN(Number(seconds))
    ) {
        return '00:00';
    }

    seconds = Math.max(0, Math.floor(Number(seconds)));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return (
            String(hours).padStart(2, '0') +
            ':' +
            String(minutes).padStart(2, '0') +
            ':' +
            String(secs).padStart(2, '0')
        );
    }

    return (
        String(minutes).padStart(2, '0') +
        ':' +
        String(secs).padStart(2, '0')
    );
}


function createProgressBar(current, total) {
    const length = 20;

    if (
        !total ||
        total <= 0 ||
        !Number.isFinite(Number(total))
    ) {
        return '━━━━━━━━━━━━━━━━━━━━';
    }

    const percent = Math.max(
        0,
        Math.min(Number(current) / Number(total), 1)
    );

    const position = Math.min(
        length - 1,
        Math.floor(percent * length)
    );

    let bar = '';

    for (let i = 0; i < length; i++) {
        bar += i === position ? '🔴' : '▬';
    }

    return bar;
}


function getLoopText(queue) {
    if (!queue) {
        return 'OFF';
    }

    if (queue.repeatMode === 1) {
        return 'TRACK';
    }

    if (queue.repeatMode === 2) {
        return 'QUEUE';
    }

    return 'OFF';
}


function getSongRequester(song) {
    if (song?.user) {
        return `${song.user}`;
    }

    return 'Unknown';
}


function isInVoice(member) {
    return Boolean(member?.voice?.channel);
}


function getBotVoiceChannel(guild) {
    return guild?.members?.me?.voice?.channel || null;
}


function sameVoiceAsBot(member, guild) {
    const userChannel = member?.voice?.channel;
    const botChannel = getBotVoiceChannel(guild);

    if (!userChannel) {
        return false;
    }

    if (!botChannel) {
        return true;
    }

    return userChannel.id === botChannel.id;
}


function hasHumanMembers(channel) {
    if (!channel) {
        return false;
    }

    return channel.members.some(
        member => !member.user.bot
    );
}


function getMusicChannel(guildId) {
    return musicChannels.get(guildId);
}


function clearEmptyTimer(guildId) {
    const timer = emptyTimers.get(guildId);

    if (timer) {
        clearTimeout(timer);
        emptyTimers.delete(guildId);

        console.log(
            `⏱️ EMPTY TIMER CANCELLED: ${guildId}`
        );
    }
}


function setMusicChannel(guildId, channel) {
    if (!guildId || !channel) {
        return;
    }

    musicChannels.set(
        guildId,
        channel
    );
}


// ======================================================
// EMBEDS
// ======================================================

function getAddedSongEmbed(song) {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setAuthor({
            name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
        })
        .setDescription(
            `➕ **تمت إضافة الأغنية إلى التشغيل**\n\n` +
            `🎵 **${song.name}**\n` +
            `⏱️ \`${song.formattedDuration || formatTime(song.duration)}\``
        )
        .setFooter({
            text: 'RED MUSIC • Music System'
        });
}


function getMusicPanel(song, queue) {
    const currentTime =
        Number(queue?.currentTime) || 0;

    const totalTime =
        Number(song?.duration) || 0;

    const progress =
        createProgressBar(
            currentTime,
            totalTime
        );

    const currentFormatted =
        formatTime(currentTime);

    const totalFormatted =
        song?.formattedDuration ||
        formatTime(totalTime);

    const embed =
        new EmbedBuilder()
            .setColor('#FF0000')
            .setAuthor({
                name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
            })
            .setTitle('🎧 NOW PLAYING')
            .setDescription(
                `🎵 **${song?.name || 'Unknown Song'}**\n\n` +
                `\`${progress}\`\n` +
                `**${currentFormatted}** ━━━━━━━━━ **${totalFormatted}**`
            )
            .setThumbnail(
                song?.thumbnail ||
                'https://i.imgur.com/83812f.png'
            )
            .addFields(
                {
                    name: '👤 REQUESTED BY',
                    value: `${getSongRequester(song)}`,
                    inline: true
                },
                {
                    name: '🔊 VOLUME',
                    value: `\`${queue?.volume ?? 100}%\``,
                    inline: true
                },
                {
                    name: '🔁 LOOP',
                    value: `\`${getLoopText(queue)}\``,
                    inline: true
                }
            )
            .setFooter({
                text: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • Music System'
            });


    const row1 =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId('btn_prev')
                    .setEmoji('⏮️')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_back10')
                    .setEmoji('⏪')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_pause')
                    .setEmoji('⏸️')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_resume')
                    .setEmoji('▶️')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('btn_forward10')
                    .setEmoji('⏩')
                    .setStyle(ButtonStyle.Secondary)
            );


    const row2 =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId('btn_skip')
                    .setEmoji('⏭️')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_loop')
                    .setEmoji('🔁')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_shuffle')
                    .setEmoji('🔀')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_queue')
                    .setEmoji('📋')
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId('btn_stop')
                    .setEmoji('⏹️')
                    .setStyle(ButtonStyle.Danger)
            );


    const row3 =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId('btn_voldown')
                    .setEmoji('🔉')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_volup')
                    .setEmoji('🔊')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_back30')
                    .setLabel('-30s')
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId('btn_forward30')
                    .setLabel('+30s')
                    .setStyle(ButtonStyle.Secondary)
            );


    return {
        embeds: [embed],
        components: [
            row1,
            row2,
            row3
        ]
    };
}


function getCommandListEmbed() {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setAuthor({
            name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
        })
        .setTitle('📋 RED MUSIC • COMMANDS')
        .setDescription(
            `**🎵 MUSIC**\n` +
            `\`/play <song>\` — تشغيل أغنية\n` +
            `\`5p <song>\` — تشغيل أغنية\n` +
            `\`5play <song>\` — تشغيل أغنية\n\n` +

            `**📋 PLAYLIST**\n` +
            `\`/playlist\` — عرض قائمة التشغيل\n` +
            `\`/lista\` — عرض قائمة التشغيل\n` +
            `\`/list create <name>\` — إنشاء قائمة\n` +
            `\`/list add <name> <song>\` — إضافة أغنية\n` +
            `\`/list show\` — عرض القوائم\n` +
            `\`/list play <name>\` — تشغيل قائمة\n\n` +

            `**🎧 CONTROL**\n` +
            `\`/stop\` — إيقاف الموسيقى\n` +
            `\`/pause\` — إيقاف مؤقت\n` +
            `\`/resume\` — استئناف\n` +
            `\`/skip\` — تخطي\n` +
            `\`/seek <seconds>\` — الانتقال لوقت محدد\n\n` +

            `**🔊 VOICE**\n` +
            `\`/join\` — دخول الروم\n` +
            `\`/leave\` — خروج البوت\n\n` +

            `**🔴 SYSTEM**\n` +
            `\`/247\` — تشغيل/إيقاف 24/7\n` +
            `\`/ping\` — سرعة البوت\n\n` +

            `**⚡ SHORTCUTS**\n` +
            `\`5p\` • \`5play\` • \`5stop\` • \`5skip\`\n` +
            `\`5pause\` • \`5resume\` • \`5join\` • \`5leave\`\n` +
            `\`5247\` • \`5ping\` • \`5command\` • \`5list\``
        )
        .setFooter({
            text: 'RED MUSIC • Music System'
        });
}


function getPingEmbed() {
    const ping = client.ws.ping;

    return new EmbedBuilder()
        .setColor('#FF0000')
        .setAuthor({
            name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
        })
        .setTitle('🏓 PONG!')
        .setDescription(
            `🤖 **Bot Ping:** \`${ping}ms\`\n` +
            `🌐 **API Ping:** \`${ping}ms\``
        )
        .setFooter({
            text: 'RED MUSIC • System'
        });
}


// ======================================================
// VOICE MESSAGES
// ======================================================

async function sendJoinMessage(channel) {
    if (!channel) {
        return;
    }

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#FF0000')
                .setAuthor({
                    name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
                })
                .setDescription(
                    `🔴 **RED MUSIC**\n\n` +
                    `🎧 **تم دخول البوت إلى الروم الصوتي**`
                )
                .setFooter({
                    text: 'RED MUSIC • Music System'
                })
        ]
    }).catch(() => {});
}


async function sendLeaveMessage(guildId) {
    const channel =
        getMusicChannel(guildId);

    if (!channel) {
        return;
    }

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#FF0000')
                .setAuthor({
                    name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
                })
                .setDescription(
                    `🔴 **RED MUSIC**\n\n` +
                    `👋 **تم إخراج البوت من الروم الصوتي**`
                )
                .setFooter({
                    text: 'RED MUSIC • Music System'
                })
        ]
    }).catch(() => {});
}


async function sendStopMessage(guildId) {
    const channel =
        getMusicChannel(guildId);

    if (!channel) {
        return;
    }

    await channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#FF0000')
                .setAuthor({
                    name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
                })
                .setDescription(
                    `⏹️ **تم إيقاف الموسيقى**\n\n` +
                    `▶️ يمكنك تشغيل أغنية جديدة باستخدام **/play** أو **5p**.`
                )
                .setFooter({
                    text: 'RED MUSIC • Music System'
                })
        ]
    }).catch(() => {});
}


// ======================================================
// PANEL
// ======================================================

async function deleteMusicPanel(guildId) {
    const panel =
        musicPanels.get(guildId);

    if (!panel) {
        return;
    }

    try {
        await panel.message.delete();
    } catch {}

    musicPanels.delete(guildId);
}


async function createMusicPanel(queue, song) {
    if (!queue || !song) {
        return null;
    }

    const guildId =
        queue.id;

    const channel =
        getMusicChannel(guildId) ||
        queue.textChannel;

    if (!channel) {
        console.log(
            `❌ PANEL CHANNEL NOT FOUND: ${guildId}`
        );

        return null;
    }

    setMusicChannel(
        guildId,
        channel
    );

    const oldPanel =
        musicPanels.get(guildId);

    if (oldPanel?.message) {
        try {
            await oldPanel.message.delete();
        } catch {}
    }

    try {
        const message =
            await channel.send(
                getMusicPanel(
                    song,
                    queue
                )
            );

        musicPanels.set(
            guildId,
            {
                message,
                channel
            }
        );

        console.log(
            `🎛️ PANEL CREATED: ${guildId}`
        );

        return message;

    } catch (error) {

        console.error(
            `❌ PANEL CREATE ERROR ${guildId}:`,
            error.message
        );

        return null;
    }
}


async function updateMusicPanel(guildId) {
    const panel =
        musicPanels.get(guildId);

    if (!panel?.message) {
        return;
    }

    const queue =
        distube.getQueue(guildId);

    if (!queue || !queue.songs?.length) {
        return;
    }

    const song =
        queue.songs[0];

    try {

        await panel.message.edit(
            getMusicPanel(
                song,
                queue
            )
        );

    } catch (error) {

        if (
            error?.code === 10008
        ) {
            musicPanels.delete(
                guildId
            );
            return;
        }

        console.error(
            `❌ PANEL UPDATE ERROR ${guildId}:`,
            error.message
        );
    }
}


// ======================================================
// VOICE LEAVE
// ======================================================

async function leaveGuildVoice(guild, sendMessage = false) {
    if (!guild) {
        return;
    }

    const guildId =
        guild.id;

    clearEmptyTimer(guildId);

    try {
        const queue =
            distube.getQueue(guildId);

        if (queue) {
            try {
                await queue.stop();
            } catch {}
        }
    } catch {}

    try {
        distube.voices.leave(
            guildId
        );
    } catch {}

    await deleteMusicPanel(
        guildId
    );

    if (sendMessage) {
        await sendLeaveMessage(
            guildId
        );
    }
}


// ======================================================
// 5-MINUTE EMPTY TIMER
// ======================================================

function startEmptyTimer(guild) {
    if (!guild) {
        return;
    }

    const guildId =
        guild.id;

    if (
        mode247.get(guildId)
    ) {
        return;
    }

    const botChannel =
        getBotVoiceChannel(guild);

    if (!botChannel) {
        return;
    }

    if (
        hasHumanMembers(botChannel)
    ) {
        clearEmptyTimer(guildId);
        return;
    }

    if (
        emptyTimers.has(guildId)
    ) {
        return;
    }

    console.log(
        `⏱️ EMPTY ROOM: ${guildId} - leaving in 5 minutes`
    );

    const timer =
        setTimeout(
            async () => {

                emptyTimers.delete(
                    guildId
                );

                const currentChannel =
                    getBotVoiceChannel(guild);

                if (!currentChannel) {
                    return;
                }

                if (
                    mode247.get(guildId)
                ) {
                    console.log(
                        `🔴 24/7 ACTIVE - KEEPING BOT: ${guildId}`
                    );
                    return;
                }

                if (
                    hasHumanMembers(
                        currentChannel
                    )
                ) {
                    console.log(
                        `👤 USER RETURNED - BOT STAYS: ${guildId}`
                    );
                    return;
                }

                console.log(
                    `🚪 5 MINUTES FINISHED - LEAVING: ${guildId}`
                );

                await leaveGuildVoice(
                    guild,
                    true
                );
            },
            EMPTY_LEAVE_DELAY
        );

    emptyTimers.set(
        guildId,
        timer
    );
}


// ======================================================
// COMMANDS
// ======================================================

function getCommands() {
    return [

        new SlashCommandBuilder()
            .setName('command')
            .setDescription('عرض جميع أوامر RED MUSIC'),

        new SlashCommandBuilder()
            .setName('play')
            .setDescription('تشغيل أغنية بالاسم أو الرابط')
            .addStringOption(option =>
                option
                    .setName('song')
                    .setDescription('اسم الأغنية أو جزء منها أو رابط')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('playlist')
            .setDescription('عرض قائمة التشغيل الحالية'),

        new SlashCommandBuilder()
            .setName('lista')
            .setDescription('عرض قائمة التشغيل الحالية'),

        new SlashCommandBuilder()
            .setName('list')
            .setDescription('إدارة قوائم RED MUSIC')

            .addSubcommand(sub =>
                sub
                    .setName('create')
                    .setDescription('إنشاء قائمة جديدة')
                    .addStringOption(option =>
                        option
                            .setName('name')
                            .setDescription('اسم القائمة')
                            .setRequired(true)
                    )
            )

            .addSubcommand(sub =>
                sub
                    .setName('add')
                    .setDescription('إضافة أغنية إلى قائمة')
                    .addStringOption(option =>
                        option
                            .setName('name')
                            .setDescription('اسم القائمة')
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('song')
                            .setDescription('اسم الأغنية أو الرابط')
                            .setRequired(true)
                    )
            )

            .addSubcommand(sub =>
                sub
                    .setName('show')
                    .setDescription('عرض القوائم المحفوظة')
            )

            .addSubcommand(sub =>
                sub
                    .setName('play')
                    .setDescription('تشغيل قائمة')
                    .addStringOption(option =>
                        option
                            .setName('name')
                            .setDescription('اسم القائمة')
                            .setRequired(true)
                    )
            ),

        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('إيقاف الموسيقى'),

        new SlashCommandBuilder()
            .setName('skip')
            .setDescription('تخطي الأغنية'),

        new SlashCommandBuilder()
            .setName('pause')
            .setDescription('إيقاف مؤقت'),

        new SlashCommandBuilder()
            .setName('resume')
            .setDescription('استئناف الموسيقى'),

        new SlashCommandBuilder()
            .setName('join')
            .setDescription('دخول الروم الصوتي'),

        new SlashCommandBuilder()
            .setName('leave')
            .setDescription('الخروج من الروم الصوتي'),

        new SlashCommandBuilder()
            .setName('247')
            .setDescription('تفعيل أو إيقاف وضع 24/7'),

        new SlashCommandBuilder()
            .setName('seek')
            .setDescription('الانتقال إلى وقت محدد')
            .addIntegerOption(option =>
                option
                    .setName('seconds')
                    .setDescription('عدد الثواني')
                    .setRequired(true)
                    .setMinValue(0)
            ),

        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('عرض سرعة استجابة البوت')

    ].map(
        command => command.toJSON()
    );
}


// ======================================================
// PLAY
// ======================================================

async function playMusic({
    voiceChannel,
    query,
    textChannel,
    member
}) {
    if (!voiceChannel) {
        throw new Error(
            'يجب أن تكون داخل روم صوتي أولاً.'
        );
    }

    if (!query || !query.trim()) {
        throw new Error(
            'اكتب اسم الأغنية أو جزءاً من اسمها أو الرابط.'
        );
    }

    setMusicChannel(
        voiceChannel.guild.id,
        textChannel
    );

    clearEmptyTimer(
        voiceChannel.guild.id
    );

    await distube.play(
        voiceChannel,
        query.trim(),
        {
            textChannel,
            member
        }
    );
}


// ======================================================
// PLAYLIST HELPERS
// ======================================================

function getGuildPlaylists(guildId) {
    if (!savedPlaylists.has(guildId)) {
        savedPlaylists.set(
            guildId,
            new Map()
        );
    }

    return savedPlaylists.get(
        guildId
    );
}


function createPlaylist(guildId, name) {
    const lists =
        getGuildPlaylists(guildId);

    const key =
        name.trim().toLowerCase();

    if (!key) {
        throw new Error(
            'اكتب اسم القائمة.'
        );
    }

    if (lists.has(key)) {
        throw new Error(
            'هذه القائمة موجودة مسبقاً.'
        );
    }

    lists.set(
        key,
        {
            name: name.trim(),
            songs: []
        }
    );

    return lists.get(key);
}


function addToPlaylist(guildId, name, song) {
    const lists =
        getGuildPlaylists(guildId);

    const playlist =
        lists.get(
            name.trim().toLowerCase()
        );

    if (!playlist) {
        throw new Error(
            'القائمة غير موجودة. أنشئها أولاً.'
        );
    }

    playlist.songs.push(
        song.trim()
    );

    return playlist;
}


async function playPlaylist({
    guildId,
    voiceChannel,
    textChannel,
    member,
    playlist
}) {
    if (
        !playlist ||
        !playlist.songs.length
    ) {
        throw new Error(
            'القائمة فارغة.'
        );
    }

    setMusicChannel(
        guildId,
        textChannel
    );

    clearEmptyTimer(
        guildId
    );

    for (
        const song of playlist.songs
    ) {
        await distube.play(
            voiceChannel,
            song,
            {
                textChannel,
                member
            }
        );
    }
}


// ======================================================
// READY
// ======================================================

client.once(
    'clientReady',
    async () => {

        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(
            `✅ ${client.user.tag} ONLINE`
        );
        console.log(
            `🆔 ${client.user.id}`
        );
        console.log(
            `🎵 DisTube ${distube.version}`
        );
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');


        const rest =
            new REST({
                version: '10'
            }).setToken(
                TOKEN
            );

        const commands =
            getCommands();


        try {

            // --------------------------------------------------
            // حذف Global Commands القديمة
            // حتى لا تتكرر الأوامر
            // --------------------------------------------------

            await rest.put(
                Routes.applicationCommands(
                    client.user.id
                ),
                {
                    body: []
                }
            );

            console.log(
                '🧹 OLD GLOBAL COMMANDS CLEARED'
            );


            // --------------------------------------------------
            // تسجيل الأوامر لكل سيرفر
            // تظهر فوراً تقريباً
            // --------------------------------------------------

            for (
                const guild
                of client.guilds.cache.values()
            ) {

                try {

                    await rest.put(
                        Routes.applicationGuildCommands(
                            client.user.id,
                            guild.id
                        ),
                        {
                            body: commands
                        }
                    );

                    console.log(
                        `✅ COMMANDS REGISTERED: ${guild.name}`
                    );

                } catch (error) {

                    console.error(
                        `❌ COMMAND REGISTER ERROR: ${guild.id}`,
                        error.message
                    );
                }
            }


            console.log('');
            console.log(
                `✅ ${commands.length} SLASH COMMANDS READY`
            );

            console.log(
                '⚡ Prefix: 5'
            );

            console.log(
                '🎛️ Control Panel: READY'
            );

            console.log(
                '⏱️ Empty Room Timeout: 5 MINUTES'
            );

            console.log(
                '🔴 24/7: READY'
            );

            console.log(
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
            );

        } catch (error) {

            console.error(
                '❌ COMMAND REGISTRATION ERROR:',
                error
            );
        }
    }
);


// ======================================================
// DISTUBE EVENTS
// ======================================================

// Queue initialization
distube.on(
    'initQueue',
    queue => {

        console.log(
            `✅ QUEUE CREATED: ${queue.id}`
        );

        if (queue.textChannel) {
            setMusicChannel(
                queue.id,
                queue.textChannel
            );
        }
    }
);


// Song added
distube.on(
    'addSong',
    async (queue, song) => {

        console.log(
            `➕ ADD SONG: ${song.name}`
        );

        if (queue.textChannel) {
            setMusicChannel(
                queue.id,
                queue.textChannel
            );
        }

        clearEmptyTimer(
            queue.id
        );

        const channel =
            getMusicChannel(queue.id) ||
            queue.textChannel;

        if (!channel) {
            return;
        }

        await channel.send({
            embeds: [
                getAddedSongEmbed(song)
            ]
        }).catch(() => {});
    }
);


// Song starts playing
distube.on(
    'playSong',
    async (queue, song) => {

        console.log(
            `▶️ PLAY SONG: ${song.name}`
        );

        clearEmptyTimer(
            queue.id
        );

        if (queue.textChannel) {
            setMusicChannel(
                queue.id,
                queue.textChannel
            );
        }

        try {

            await createMusicPanel(
                queue,
                song
            );

        } catch (error) {

            console.error(
                `❌ PANEL ERROR: ${queue.id}`,
                error.message
            );
        }
    }
);


// Song finished
distube.on(
    'finishSong',
    async (queue, song) => {

        console.log(
            `🏁 FINISH SONG: ${song?.name || 'Unknown'}`
        );

        await updateMusicPanel(
            queue.id
        );
    }
);


// Entire queue finished
distube.on(
    'finish',
    async queue => {

        console.log(
            `🏁 QUEUE FINISHED: ${queue.id}`
        );

        const guild =
            client.guilds.cache.get(
                queue.id
            );

        if (!guild) {
            return;
        }

        const botChannel =
            getBotVoiceChannel(guild);

        // إذا 24/7 لا نبدأ خروج
        if (
            mode247.get(queue.id)
        ) {
            console.log(
                `🔴 24/7 ACTIVE - KEEPING BOT AFTER FINISH: ${queue.id}`
            );
            return;
        }

        // إذا الروم فاضي نبدأ 5 دقائق
        if (
            botChannel &&
            !hasHumanMembers(botChannel)
        ) {
            startEmptyTimer(
                guild
            );
        }
    }
);


// Disconnect
distube.on(
    'disconnect',
    queue => {

        const guild =
            client.guilds.cache.get(
                queue.id
            );

        if (!guild) {
            return;
        }

        console.log(
            `⚠️ DISTUBE DISCONNECT: ${queue.id}`
        );

        // لا نحاول الخروج اليدوي مرة ثانية
        if (
            manualLeave.has(queue.id)
        ) {
            return;
        }

        // 24/7 يعيد الاتصال
        if (
            mode247.get(queue.id)
        ) {

            const channel =
                getBotVoiceChannel(guild);

            if (channel) {

                setTimeout(
                    async () => {

                        try {

                            const current =
                                getBotVoiceChannel(
                                    guild
                                );

                            if (!current) {

                                await distube.voices.join(
                                    channel
                                );

                                console.log(
                                    `🔄 24/7 RECONNECTED: ${queue.id}`
                                );
                            }

                        } catch (error) {

                            console.error(
                                `❌ 24/7 RECONNECT ERROR ${queue.id}:`,
                                error.message
                            );
                        }

                    },
                    3000
                );
            }
        }
    }
);


// Delete queue
distube.on(
    'deleteQueue',
    queue => {

        console.log(
            `🗑️ QUEUE DELETED: ${queue.id}`
        );
    }
);


// Error
distube.on(
    'error',
    async (error, queue, song) => {

        console.error(
            '❌ DISTUBE ERROR:',
            error
        );

        const guildId =
            queue?.id;

        if (!guildId) {
            return;
        }

        const channel =
            getMusicChannel(guildId) ||
            queue?.textChannel;

        if (!channel) {
            return;
        }

        const songName =
            song?.name ||
            queue?.songs?.[0]?.name ||
            'Unknown Song';

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor('#FF0000')
                    .setAuthor({
                        name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
                    })
                    .setDescription(
                        `❌ **لم أستطع تشغيل الأغنية**\n\n` +
                        `🎵 **${songName}**\n\n` +
                        `🔄 جرّب اسم الأغنية مرة أخرى أو أرسل رابطاً آخر.`
                    )
                    .setFooter({
                        text: 'RED MUSIC • Music System'
                    })
            ]
        }).catch(() => {});
    }
);


// ======================================================
// PANEL AUTO UPDATE
// ======================================================

setInterval(
    async () => {

        for (
            const guildId
            of musicPanels.keys()
        ) {

            try {

                await updateMusicPanel(
                    guildId
                );

            } catch (error) {

                console.error(
                    `❌ PANEL TIMER ERROR ${guildId}:`,
                    error.message
                );
            }
        }

    },
    PANEL_UPDATE_INTERVAL
);


// ======================================================
// MESSAGE COMMANDS
// Prefix: 5
// ======================================================

client.on(
    'messageCreate',
    async message => {

        try {

            if (
                message.author.bot ||
                !message.guild ||
                !message.content.startsWith(PREFIX)
            ) {
                return;
            }

            const raw =
                message.content
                    .slice(PREFIX.length)
                    .trim();

            if (!raw) {
                return;
            }

            const args =
                raw.split(/\s+/);

            const command =
                args
                    .shift()
                    ?.toLowerCase();

            // --------------------------------------------------
            // COMMAND
            // --------------------------------------------------

            if (
                command === 'command'
            ) {

                return message.reply({
                    embeds: [
                        getCommandListEmbed()
                    ]
                });
            }


            // --------------------------------------------------
            // PING
            // --------------------------------------------------

            if (
                command === 'ping'
            ) {

                return message.reply({
                    embeds: [
                        getPingEmbed()
                    ]
                });
            }


            const voiceChannel =
                message.member?.voice?.channel;


            // --------------------------------------------------
            // PLAY
            // 5p / 5play
            // --------------------------------------------------

            if (
                command === 'p' ||
                command === 'play'
            ) {

                if (!voiceChannel) {
                    return message.reply(
                        '❌ يجب أن تكون في روم صوتي أولاً.'
                    );
                }

                const query =
                    args.join(' ').trim();

                if (!query) {
                    return message.reply(
                        '❌ اكتب اسم الأغنية أو جزء من اسمها أو الرابط.'
                    );
                }

                try {

                    await playMusic({
                        voiceChannel,
                        query,
                        textChannel: message.channel,
                        member: message.member
                    });

                } catch (error) {

                    console.error(
                        '❌ PREFIX PLAY ERROR:',
                        error
                    );

                    return message.reply(
                        `❌ لم أستطع تشغيل الأغنية.\n> ${String(error?.message || 'Unknown error').slice(0, 1500)}`
                    ).catch(() => {});
                }

                return;
            }


            // --------------------------------------------------
            // JOIN
            // --------------------------------------------------

            if (
                command === 'join'
            ) {

                if (!voiceChannel) {
                    return message.reply(
                        '❌ يجب أن تكون في روم صوتي.'
                    );
                }

                setMusicChannel(
                    message.guildId,
                    message.channel
                );

                clearEmptyTimer(
                    message.guildId
                );

                try {

                    await distube.voices.join(
                        voiceChannel
                    );

                    await sendJoinMessage(
                        message.channel
                    );

                    return message.reply(
                        '✅ تم دخول الروم الصوتي.'
                    );

                } catch (error) {

                    console.error(
                        '❌ JOIN ERROR:',
                        error
                    );

                    return message.reply(
                        '❌ لم أستطع دخول الروم الصوتي.'
                    );
                }
            }


            // --------------------------------------------------
            // LEAVE
            // --------------------------------------------------

            if (
                command === 'leave'
            ) {

                const guildId =
                    message.guildId;

                mode247.set(
                    guildId,
                    false
                );

                manualLeave.add(
                    guildId
                );

                clearEmptyTimer(
                    guildId
                );

                await leaveGuildVoice(
                    message.guild,
                    true
                );

                setTimeout(
                    () => {
                        manualLeave.delete(
                            guildId
                        );
                    },
                    5000
                );

                return message.reply(
                    '👋 تم إخراج RED MUSIC من الروم.'
                );
            }


            // --------------------------------------------------
            // STOP
            // --------------------------------------------------

            if (
                command === 'stop'
            ) {

                const queue =
                    distube.getQueue(
                        message.guildId
                    );

                if (!queue) {
                    return message.reply(
                        '❌ لا توجد موسيقى تعمل حالياً.'
                    );
                }

                try {

                    await queue.stop();

                } catch (error) {

                    console.error(
                        '❌ STOP ERROR:',
                        error
                    );

                    return message.reply(
                        '❌ لم أستطع إيقاف الموسيقى.'
                    );
                }

                await deleteMusicPanel(
                    message.guildId
                );

                await sendStopMessage(
                    message.guildId
                );

                return message.reply(
                    '⏹️ تم إيقاف الموسيقى.'
                );
            }


            // --------------------------------------------------
            // SKIP
            // --------------------------------------------------

            if (
                command === 'skip'
            ) {

                const queue =
                    distube.getQueue(
                        message.guildId
                    );

                if (!queue) {
                    return message.reply(
                        '❌ لا توجد موسيقى.'
                    );
                }

                try {

                    await queue.skip();

                } catch (error) {

                    return message.reply(
                        `❌ لا يمكن التخطي: ${String(error?.message || '').slice(0, 500)}`
                    ).catch(() => {});
                }

                return;
            }


            // --------------------------------------------------
            // PAUSE
            // --------------------------------------------------

            if (
                command === 'pause'
            ) {

                const queue =
                    distube.getQueue(
                        message.guildId
                    );

                if (!queue) {
                    return message.reply(
                        '❌ لا توجد موسيقى.'
                    );
                }

                try {
                    await queue.pause();

                    await updateMusicPanel(
                        message.guildId
                    );

                } catch {}

                return;
            }


            // --------------------------------------------------
            // RESUME
            // --------------------------------------------------

            if (
                command === 'resume'
            ) {

                const queue =
                    distube.getQueue(
                        message.guildId
                    );

                if (!queue) {
                    return message.reply(
                        '❌ لا توجد موسيقى.'
                    );
                }

                try {
                    await queue.resume();

                    await updateMusicPanel(
                        message.guildId
                    );

                } catch {}

                return;
            }


            // --------------------------------------------------
            // 247
            // 5247
            // --------------------------------------------------

            if (
                command === '247'
            ) {

                const guildId =
                    message.guildId;

                const current =
                    mode247.get(
                        guildId
                    ) === true;

                // ----------------------------------------------
                // DISABLE
                // ----------------------------------------------

                if (current) {

                    mode247.set(
                        guildId,
                        false
                    );

                    const guild =
                        message.guild;

                    const botChannel =
                        getBotVoiceChannel(
                            guild
                        );

                    if (
                        botChannel &&
                        !hasHumanMembers(
                            botChannel
                        )
                    ) {
                        startEmptyTimer(
                            guild
                        );
                    }

                    return message.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setDescription(
                                    `🔴 **RED MUSIC 24/7**\n\n` +
                                    `الحالة: **متوقف ❌**\n\n` +
                                    `⏱️ إذا كان الروم فارغاً، سيخرج البوت بعد **5 دقائق**.`
                                )
                        ]
                    });
                }


                // ----------------------------------------------
                // ENABLE
                // ----------------------------------------------

                if (!voiceChannel) {
                    return message.reply(
                        '❌ يجب أن تكون في روم صوتي حتى تفعل 24/7.'
                    );
                }

                mode247.set(
                    guildId,
                    true
                );

                setMusicChannel(
                    guildId,
                    message.channel
                );

                clearEmptyTimer(
                    guildId
                );

                try {

                    await distube.voices.join(
                        voiceChannel
                    );

                } catch (error) {

                    mode247.set(
                        guildId,
                        false
                    );

                    console.error(
                        '❌ 247 JOIN ERROR:',
                        error
                    );

                    return message.reply(
                        '❌ لم أستطع دخول الروم لتفعيل 24/7.'
                    );
                }

                return message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#FF0000')
                            .setDescription(
                                `🔴 **RED MUSIC 24/7**\n\n` +
                                `الحالة: **مفعّل ✅**\n\n` +
                                `🎧 البوت سيبقى في الروم حتى تقوم بإيقاف **24/7** بنفسك.`
                            )
                    ]
                });
            }


            // --------------------------------------------------
            // SEEK
            // --------------------------------------------------

            if (
                command === 'seek'
            ) {

                const seconds =
                    Number(
                        args[0]
                    );

                if (
                    !Number.isFinite(seconds) ||
                    seconds < 0
                ) {
                    return message.reply(
                        '❌ اكتب عدد ثواني صحيح.'
                    );
                }

                const queue =
                    distube.getQueue(
                        message.guildId
                    );

                if (!queue) {
                    return message.reply(
                        '❌ لا توجد أغنية تعمل.'
                    );
                }

                try {

                    await queue.seek(
                        seconds
                    );

                    await updateMusicPanel(
                        message.guildId
                    );

                    return message.reply(
                        `⏩ تم الانتقال إلى \`${formatTime(seconds)}\`.`
                    );

                } catch {

                    return message.reply(
                        '❌ لا يمكن الانتقال لهذا الوقت.'
                    );
                }
            }


            // --------------------------------------------------
            // LIST
            // --------------------------------------------------

            if (
                command === 'list'
            ) {

                const sub =
                    args
                        .shift()
                        ?.toLowerCase();


                if (!sub) {
                    return message.reply(
                        '❌ استخدم: `5list create` أو `5list add` أو `5list show` أو `5list play`'
                    );
                }


                // CREATE
                if (
                    sub === 'create'
                ) {

                    const name =
                        args.join(' ').trim();

                    if (!name) {
                        return message.reply(
                            '❌ اكتب اسم القائمة.'
                        );
                    }

                    try {

                        const playlist =
                            createPlaylist(
                                message.guildId,
                                name
                            );

                        return message.reply(
                            `✅ تم إنشاء قائمة **${playlist.name}**.`
                        );

                    } catch (error) {

                        return message.reply(
                            `❌ ${error.message}`
                        );
                    }
                }


                // ADD
                if (
                    sub === 'add'
                ) {

                    const name =
                        args.shift();

                    const song =
                        args.join(' ').trim();

                    if (!name || !song) {
                        return message.reply(
                            '❌ الاستخدام: `5list add اسم_القائمة اسم_الأغنية`'
                        );
                    }

                    try {

                        const playlist =
                            addToPlaylist(
                                message.guildId,
                                name,
                                song
                            );

                        return message.reply(
                            `✅ تمت إضافة **${song}** إلى قائمة **${playlist.name}**.`
                        );

                    } catch (error) {

                        return message.reply(
                            `❌ ${error.message}`
                        );
                    }
                }


                // SHOW
                if (
                    sub === 'show'
                ) {

                    const lists =
                        getGuildPlaylists(
                            message.guildId
                        );

                    if (!lists.size) {
                        return message.reply(
                            '📋 لا توجد قوائم محفوظة.'
                        );
                    }

                    const text =
                        [...lists.values()]
                            .map(
                                list =>
                                    `📁 **${list.name}** — ${list.songs.length} أغنية`
                            )
                            .join('\n');

                    return message.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setAuthor({
                                    name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • LISTS'
                                })
                                .setTitle('📋 قوائمك')
                                .setDescription(
                                    text
                                )
                        ]
                    });
                }


                // PLAY
                if (
                    sub === 'play'
                ) {

                    if (!voiceChannel) {
                        return message.reply(
                            '❌ يجب أن تكون في روم صوتي أولاً.'
                        );
                    }

                    const name =
                        args.join(' ').trim();

                    const lists =
                        getGuildPlaylists(
                            message.guildId
                        );

                    const playlist =
                        lists.get(
                            name.toLowerCase()
                        );

                    if (!playlist) {
                        return message.reply(
                            '❌ القائمة غير موجودة.'
                        );
                    }

                    if (!playlist.songs.length) {
                        return message.reply(
                            '❌ القائمة فارغة.'
                        );
                    }

                    try {

                        await playPlaylist({
                            guildId:
                                message.guildId,

                            voiceChannel,

                            textChannel:
                                message.channel,

                            member:
                                message.member,

                            playlist
                        });

                        return message.reply(
                            `▶️ تم تشغيل قائمة **${playlist.name}**.`
                        );

                    } catch (error) {

                        console.error(
                            '❌ PLAYLIST ERROR:',
                            error
                        );

                        return message.reply(
                            '❌ حدث خطأ أثناء تشغيل القائمة.'
                        );
                    }
                }
            }

        } catch (error) {

            console.error(
                '❌ MESSAGE COMMAND ERROR:',
                error
            );
        }
    }
);


// ======================================================
// INTERACTIONS
// ======================================================

client.on(
    'interactionCreate',
    async interaction => {

        try {

            // ==================================================
            // SLASH COMMANDS
            // ==================================================

            if (
                interaction.isChatInputCommand()
            ) {

                const command =
                    interaction.commandName;

                const guild =
                    interaction.guild;

                const guildId =
                    interaction.guildId;

                const member =
                    interaction.member;

                const voiceChannel =
                    member?.voice?.channel;


                // ------------------------------------------------
                // COMMAND
                // ------------------------------------------------

                if (
                    command === 'command'
                ) {

                    return interaction.reply({
                        embeds: [
                            getCommandListEmbed()
                        ],
                        ephemeral: true
                    });
                }


                // ------------------------------------------------
                // PING
                // ------------------------------------------------

                if (
                    command === 'ping'
                ) {

                    return interaction.reply({
                        embeds: [
                            getPingEmbed()
                        ]
                    });
                }


                // ------------------------------------------------
                // PLAY
                // ------------------------------------------------

                if (
                    command === 'play'
                ) {

                    if (!voiceChannel) {
                        return interaction.reply({
                            content:
                                '❌ يجب أن تكون في روم صوتي أولاً.',
                            ephemeral: true
                        });
                    }

                    const query =
                        interaction.options
                            .getString('song');

                    await interaction.deferReply({
                        ephemeral: true
                    });

                    try {

                        await playMusic({
                            voiceChannel,
                            query,
                            textChannel:
                                interaction.channel,
                            member
                        });

                        return interaction.editReply({
                            content:
                                '✅ تم إرسال الأغنية إلى RED MUSIC.'
                        });

                    } catch (error) {

                        console.error(
                            '❌ SLASH PLAY ERROR:',
                            error
                        );

                        return interaction.editReply({
                            content:
                                `❌ لم أستطع تشغيل الأغنية.\n> ${String(error?.message || 'Unknown error').slice(0, 1500)}`
                        });
                    }
                }


                // ------------------------------------------------
                // PLAYLIST / LISTA
                // ------------------------------------------------

                if (
                    command === 'playlist' ||
                    command === 'lista'
                ) {

                    const queue =
                        distube.getQueue(
                            guildId
                        );

                    if (
                        !queue ||
                        !queue.songs?.length
                    ) {

                        return interaction.reply({
                            content:
                                '❌ القائمة فارغة حالياً.',
                            ephemeral: true
                        });
                    }

                    const list =
                        queue.songs
                            .slice(0, 20)
                            .map(
                                (song, index) =>
                                    `**${index + 1}.** 🎵 ${song.name}\n` +
                                    `└ ⏱️ \`${song.formattedDuration || formatTime(song.duration)}\``
                            )
                            .join('\n\n');

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setAuthor({
                                    name:
                                        '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • PLAYLIST'
                                })
                                .setTitle(
                                    '📋 قائمة التشغيل'
                                )
                                .setDescription(
                                    list
                                )
                                .setFooter({
                                    text:
                                        `${queue.songs.length} Songs`
                                })
                        ],
                        ephemeral: true
                    });
                }


                // ------------------------------------------------
                // LIST
                // ------------------------------------------------

                if (
                    command === 'list'
                ) {

                    const sub =
                        interaction.options
                            .getSubcommand();


                    // CREATE
                    if (
                        sub === 'create'
                    ) {

                        const name =
                            interaction.options
                                .getString('name');

                        try {

                            const playlist =
                                createPlaylist(
                                    guildId,
                                    name
                                );

                            return interaction.reply({
                                content:
                                    `✅ تم إنشاء قائمة **${playlist.name}**.`,
                                ephemeral: true
                            });

                        } catch (error) {

                            return interaction.reply({
                                content:
                                    `❌ ${error.message}`,
                                ephemeral: true
                            });
                        }
                    }


                    // ADD
                    if (
                        sub === 'add'
                    ) {

                        const name =
                            interaction.options
                                .getString('name');

                        const song =
                            interaction.options
                                .getString('song');

                        try {

                            const playlist =
                                addToPlaylist(
                                    guildId,
                                    name,
                                    song
                                );

                            return interaction.reply({
                                content:
                                    `✅ تمت إضافة **${song}** إلى قائمة **${playlist.name}**.`,
                                ephemeral: true
                            });

                        } catch (error) {

                            return interaction.reply({
                                content:
                                    `❌ ${error.message}`,
                                ephemeral: true
                            });
                        }
                    }


                    // SHOW
                    if (
                        sub === 'show'
                    ) {

                        const lists =
                            getGuildPlaylists(
                                guildId
                            );

                        if (!lists.size) {

                            return interaction.reply({
                                content:
                                    '📋 لا توجد قوائم محفوظة.',
                                ephemeral: true
                            });
                        }

                        const text =
                            [...lists.values()]
                                .map(
                                    list =>
                                        `📁 **${list.name}** — ${list.songs.length} أغنية`
                                )
                                .join('\n');

                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor('#FF0000')
                                    .setAuthor({
                                        name:
                                            '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • LISTS'
                                    })
                                    .setTitle(
                                        '📋 القوائم المحفوظة'
                                    )
                                    .setDescription(
                                        text
                                    )
                            ],
                            ephemeral: true
                        });
                    }


                    // PLAY
                    if (
                        sub === 'play'
                    ) {

                        if (!voiceChannel) {

                            return interaction.reply({
                                content:
                                    '❌ يجب أن تكون في روم صوتي أولاً.',
                                ephemeral: true
                            });
                        }

                        const name =
                            interaction.options
                                .getString('name');

                        const lists =
                            getGuildPlaylists(
                                guildId
                            );

                        const playlist =
                            lists.get(
                                name.toLowerCase()
                            );

                        if (!playlist) {

                            return interaction.reply({
                                content:
                                    '❌ القائمة غير موجودة.',
                                ephemeral: true
                            });
                        }

                        if (!playlist.songs.length) {

                            return interaction.reply({
                                content:
                                    '❌ القائمة فارغة.',
                                ephemeral: true
                            });
                        }

                        await interaction.deferReply({
                            ephemeral: true
                        });

                        try {

                            await playPlaylist({
                                guildId,

                                voiceChannel,

                                textChannel:
                                    interaction.channel,

                                member,

                                playlist
                            });

                            return interaction.editReply({
                                content:
                                    `▶️ تم تشغيل قائمة **${playlist.name}**.`
                            });

                        } catch (error) {

                            console.error(
                                '❌ SLASH PLAYLIST ERROR:',
                                error
                            );

                            return interaction.editReply({
                                content:
                                    '❌ حدث خطأ أثناء تشغيل القائمة.'
                            });
                        }
                    }
                }


                // ------------------------------------------------
                // JOIN
                // ------------------------------------------------

                if (
                    command === 'join'
                ) {

                    if (!voiceChannel) {

                        return interaction.reply({
                            content:
                                '❌ يجب أن تكون في روم صوتي.',
                            ephemeral: true
                        });
                    }

                    setMusicChannel(
                        guildId,
                        interaction.channel
                    );

                    clearEmptyTimer(
                        guildId
                    );

                    try {

                        await distube.voices.join(
                            voiceChannel
                        );

                        await sendJoinMessage(
                            interaction.channel
                        );

                        return interaction.reply({
                            content:
                                '✅ تم دخول الروم الصوتي.',
                            ephemeral: true
                        });

                    } catch (error) {

                        console.error(
                            '❌ JOIN ERROR:',
                            error
                        );

                        return interaction.reply({
                            content:
                                '❌ لم أستطع دخول الروم.',
                            ephemeral: true
                        });
                    }
                }


                // ------------------------------------------------
                // LEAVE
                // ------------------------------------------------

                if (
                    command === 'leave'
                ) {

                    mode247.set(
                        guildId,
                        false
                    );

                    manualLeave.add(
                        guildId
                    );

                    clearEmptyTimer(
                        guildId
                    );

                    await leaveGuildVoice(
                        guild,
                        true
                    );

                    setTimeout(
                        () => {
                            manualLeave.delete(
                                guildId
                            );
                        },
                        5000
                    );

                    return interaction.reply({
                        content:
                            '👋 تم إخراج RED MUSIC من الروم.',
                        ephemeral: true
                    });
                }


                // ------------------------------------------------
                // STOP
                // ------------------------------------------------

                if (
                    command === 'stop'
                ) {

                    const queue =
                        distube.getQueue(
                            guildId
                        );

                    if (!queue) {

                        return interaction.reply({
                            content:
                                '❌ لا توجد موسيقى.',
                            ephemeral: true
                        });
                    }

                    try {

                        await queue.stop();

                    } catch {

                        return interaction.reply({
                            content:
                                '❌ لم أستطع إيقاف الموسيقى.',
                            ephemeral: true
                        });
                    }

                    await deleteMusicPanel(
                        guildId
                    );

                    await sendStopMessage(
                        guildId
                    );

                    return interaction.reply({
                        content:
                            '⏹️ تم إيقاف الموسيقى.',
                        ephemeral: true
                    });
                }


                // ------------------------------------------------
                // SKIP
                // ------------------------------------------------

                if (
                    command === 'skip'
                ) {

                    const queue =
                        distube.getQueue(
                            guildId
                        );

                    if (!queue) {

                        return interaction.reply({
                            content:
                                '❌ لا توجد موسيقى.',
                            ephemeral: true
                        });
                    }

                    try {

                        await queue.skip();

                        return interaction.reply({
                            content:
                                '⏭️ تم تخطي الأغنية.',
                            ephemeral: true
                        });

                    } catch {

                        return interaction.reply({
                            content:
                                '❌ لا توجد أغنية أخرى.',
                            ephemeral: true
                        });
                    }
                }


                // ------------------------------------------------
                // PAUSE
                // ------------------------------------------------

                if (
                    command === 'pause'
                ) {

                    const queue =
                        distube.getQueue(
                            guildId
                        );

                    if (!queue) {

                        return interaction.reply({
                            content:
                                '❌ لا توجد موسيقى.',
                            ephemeral: true
                        });
                    }

                    try {

                        await queue.pause();

                        await updateMusicPanel(
                            guildId
                        );

                        return interaction.reply({
                            content:
                                '⏸️ تم إيقاف الموسيقى مؤقتاً.',
                            ephemeral: true
                        });

                    } catch {

                        return interaction.reply({
                            content:
                                '❌ تعذر الإيقاف المؤقت.',
                            ephemeral: true
                        });
                    }
                }


                // ------------------------------------------------
                // RESUME
                // ------------------------------------------------

                if (
                    command === 'resume'
                ) {

                    const queue =
                        distube.getQueue(
                            guildId
                        );

                    if (!queue) {

                        return interaction.reply({
                            content:
                                '❌ لا توجد موسيقى.',
                            ephemeral: true
                        });
                    }

                    try {

                        await queue.resume();

                        await updateMusicPanel(
                            guildId
                        );

                        return interaction.reply({
                            content:
                                '▶️ تم استئناف الموسيقى.',
                            ephemeral: true
                        });

                    } catch {

                        return interaction.reply({
                            content:
                                '❌ تعذر استئناف الموسيقى.',
                            ephemeral: true
                        });
                    }
                }


                // ------------------------------------------------
                // SEEK
                // ------------------------------------------------

                if (
                    command === 'seek'
                ) {

                    const seconds =
                        interaction.options
                            .getInteger('seconds');

                    const queue =
                        distube.getQueue(
                            guildId
                        );

                    if (!queue) {

                        return interaction.reply({
                            content:
                                '❌ لا توجد أغنية.',
                            ephemeral: true
                        });
                    }

                    try {

                        await queue.seek(
                            seconds
                        );

                        await updateMusicPanel(
                            guildId
                        );

                        return interaction.reply({
                            content:
                                `⏩ تم الانتقال إلى \`${formatTime(seconds)}\`.`,
                            ephemeral: true
                        });

                    } catch {

                        return interaction.reply({
                            content:
                                '❌ لا يمكن الانتقال لهذا الوقت.',
                            ephemeral: true
                        });
                    }
                }


                // ------------------------------------------------
                // 247
                // ------------------------------------------------

                if (
                    command === '247'
                ) {

                    const enabled =
                        mode247.get(
                            guildId
                        ) === true;


                    // DISABLE
                    if (enabled) {

                        mode247.set(
                            guildId,
                            false
                        );

                        const botChannel =
                            getBotVoiceChannel(
                                guild
                            );

                        if (
                            botChannel &&
                            !hasHumanMembers(
                                botChannel
                            )
                        ) {
                            startEmptyTimer(
                                guild
                            );
                        }

                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor('#FF0000')
                                    .setDescription(
                                        `🔴 **RED MUSIC 24/7**\n\n` +
                                        `الحالة: **متوقف ❌**\n\n` +
                                        `⏱️ إذا كان الروم فارغاً سيخرج البوت بعد **5 دقائق**.`
                                    )
                            ],
                            ephemeral: true
                        });
                    }


                    // ENABLE
                    if (!voiceChannel) {

                        return interaction.reply({
                            content:
                                '❌ يجب أن تكون في روم صوتي حتى تفعل 24/7.',
                            ephemeral: true
                        });
                    }

                    mode247.set(
                        guildId,
                        true
                    );

                    setMusicChannel(
                        guildId,
                        interaction.channel
                    );

                    clearEmptyTimer(
                        guildId
                    );

                    try {

                        await distube.voices.join(
                            voiceChannel
                        );

                    } catch (error) {

                        mode247.set(
                            guildId,
                            false
                        );

                        console.error(
                            '❌ 247 ERROR:',
                            error
                        );

                        return interaction.reply({
                            content:
                                '❌ لم أستطع دخول الروم.',
                            ephemeral: true
                        });
                    }

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setDescription(
                                    `🔴 **RED MUSIC 24/7**\n\n` +
                                    `الحالة: **مفعّل ✅**\n\n` +
                                    `🎧 لن يخرج البوت تلقائياً حتى تقوم بإيقاف 24/7.`
                                )
                        ],
                        ephemeral: true
                    });
                }
            }


            // ==================================================
            // BUTTONS
            // ==================================================

            if (
                interaction.isButton()
            ) {

                const guild =
                    interaction.guild;

                const guildId =
                    interaction.guildId;

                const member =
                    interaction.member;


                // ----------------------------------------------
                // Voice check
                // ----------------------------------------------

                if (!isInVoice(member)) {

                    return interaction.reply({
                        content:
                            '❌ يجب أن تكون داخل روم صوتي حتى تتحكم بالموسيقى.',
                        ephemeral: true
                    });
                }


                // ----------------------------------------------
                // Same channel check
                // ----------------------------------------------

                if (
                    getBotVoiceChannel(guild) &&
                    !sameVoiceAsBot(
                        member,
                        guild
                    )
                ) {

                    return interaction.reply({
                        content:
                            '❌ يجب أن تكون في نفس الروم الصوتي مع RED MUSIC.',
                        ephemeral: true
                    });
                }


                const id =
                    interaction.customId;


                // QUEUE button can still show queue
                // only if queue exists

                const queue =
                    distube.getQueue(
                        guildId
                    );


                if (!queue) {

                    return interaction.reply({
                        content:
                            '❌ لا توجد موسيقى تعمل حالياً.',
                        ephemeral: true
                    });
                }


                // ----------------------------------------------
                // Previous
                // ----------------------------------------------

                if (
                    id === 'btn_prev'
                ) {

                    try {

                        await interaction.deferUpdate();

                        await queue.previous();

                        await updateMusicPanel(
                            guildId
                        );

                    } catch {

                        if (
                            interaction.deferred
                        ) {
                            await interaction.followUp({
                                content:
                                    '❌ لا توجد أغنية سابقة.',
                                ephemeral: true
                            }).catch(() => {});
                        } else {
                            await interaction.reply({
                                content:
                                    '❌ لا توجد أغنية سابقة.',
                                ephemeral: true
                            }).catch(() => {});
                        }
                    }

                    return;
                }


                // ----------------------------------------------
                // Back 10
                // ----------------------------------------------

                if (
                    id === 'btn_back10'
                ) {

                    await interaction.deferUpdate();

                    const current =
                        Number(queue.currentTime) || 0;

                    await queue.seek(
                        Math.max(
                            0,
                            current - 10
                        )
                    );

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Forward 10
                // ----------------------------------------------

                if (
                    id === 'btn_forward10'
                ) {

                    await interaction.deferUpdate();

                    const current =
                        Number(queue.currentTime) || 0;

                    const duration =
                        Number(
                            queue.songs[0]?.duration
                        ) || 0;

                    await queue.seek(
                        Math.min(
                            duration,
                            current + 10
                        )
                    );

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Pause
                // ----------------------------------------------

                if (
                    id === 'btn_pause'
                ) {

                    await interaction.deferUpdate();

                    if (!queue.paused) {
                        await queue.pause();
                    }

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Resume
                // ----------------------------------------------

                if (
                    id === 'btn_resume'
                ) {

                    await interaction.deferUpdate();

                    if (queue.paused) {
                        await queue.resume();
                    }

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Skip
                // ----------------------------------------------

                if (
                    id === 'btn_skip'
                ) {

                    await interaction.deferUpdate();

                    try {
                        await queue.skip();
                    } catch {}

                    return;
                }


                // ----------------------------------------------
                // Loop
                // ----------------------------------------------

                if (
                    id === 'btn_loop'
                ) {

                    await interaction.deferUpdate();

                    queue.setRepeatMode();

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Shuffle
                // ----------------------------------------------

                if (
                    id === 'btn_shuffle'
                ) {

                    await interaction.deferUpdate();

                    try {
                        await queue.shuffle();
                    } catch {}

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Queue
                // ----------------------------------------------

                if (
                    id === 'btn_queue'
                ) {

                    const list =
                        queue.songs
                            .slice(0, 20)
                            .map(
                                (song, index) =>
                                    `**${index + 1}.** 🎵 ${song.name}\n` +
                                    `└ ⏱️ \`${song.formattedDuration || formatTime(song.duration)}\``
                            )
                            .join('\n\n');

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setAuthor({
                                    name:
                                        '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • QUEUE'
                                })
                                .setTitle(
                                    '📋 قائمة التشغيل'
                                )
                                .setDescription(
                                    list ||
                                    'القائمة فارغة.'
                                )
                                .setFooter({
                                    text:
                                        `${queue.songs.length} Songs`
                                })
                        ],
                        ephemeral: true
                    });
                }


                // ----------------------------------------------
                // Stop
                // ----------------------------------------------

                if (
                    id === 'btn_stop'
                ) {

                    await interaction.deferUpdate();

                    try {
                        await queue.stop();
                    } catch {}

                    await deleteMusicPanel(
                        guildId
                    );

                    await sendStopMessage(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Volume Down
                // ----------------------------------------------

                if (
                    id === 'btn_voldown'
                ) {

                    await interaction.deferUpdate();

                    const volume =
                        Math.max(
                            0,
                            Number(queue.volume) - 10
                        );

                    queue.setVolume(
                        volume
                    );

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Volume Up
                // ----------------------------------------------

                if (
                    id === 'btn_volup'
                ) {

                    await interaction.deferUpdate();

                    const volume =
                        Math.min(
                            100,
                            Number(queue.volume) + 10
                        );

                    queue.setVolume(
                        volume
                    );

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Back 30
                // ----------------------------------------------

                if (
                    id === 'btn_back30'
                ) {

                    await interaction.deferUpdate();

                    const current =
                        Number(queue.currentTime) || 0;

                    await queue.seek(
                        Math.max(
                            0,
                            current - 30
                        )
                    );

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }


                // ----------------------------------------------
                // Forward 30
                // ----------------------------------------------

                if (
                    id === 'btn_forward30'
                ) {

                    await interaction.deferUpdate();

                    const current =
                        Number(queue.currentTime) || 0;

                    const duration =
                        Number(
                            queue.songs[0]?.duration
                        ) || 0;

                    await queue.seek(
                        Math.min(
                            duration,
                            current + 30
                        )
                    );

                    await updateMusicPanel(
                        guildId
                    );

                    return;
                }
            }

        } catch (error) {

            console.error(
                '❌ INTERACTION ERROR:',
                error
            );

            try {

                if (
                    interaction.isRepliable() &&
                    !interaction.replied &&
                    !interaction.deferred
                ) {

                    await interaction.reply({
                        content:
                            '❌ حدث خطأ غير متوقع، حاول مرة أخرى.',
                        ephemeral: true
                    });

                } else if (
                    interaction.isRepliable() &&
                    interaction.deferred
                ) {

                    await interaction.editReply({
                        content:
                            '❌ حدث خطأ غير متوقع، حاول مرة أخرى.'
                    }).catch(() => {});
                }

            } catch {}
        }
    }
);


// ======================================================
// VOICE STATE UPDATE
// ======================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {

        try {

            const guild =
                newState.guild ||
                oldState.guild;

            if (!guild) {
                return;
            }

            const guildId =
                guild.id;


            // ==================================================
            // BOT VOICE STATE
            // ==================================================

            if (
                oldState.member?.id === client.user.id ||
                newState.member?.id === client.user.id
            ) {

                // ----------------------------------------------
                // Bot left voice
                // ----------------------------------------------

                if (
                    oldState.channelId &&
                    !newState.channelId
                ) {

                    console.log(
                        `🚪 BOT LEFT VOICE: ${guildId}`
                    );

                    clearEmptyTimer(
                        guildId
                    );

                    if (
                        mode247.get(guildId) &&
                        !manualLeave.has(guildId)
                    ) {

                        const oldChannel =
                            oldState.channel;

                        if (oldChannel) {

                            setTimeout(
                                async () => {

                                    try {

                                        if (
                                            mode247.get(guildId) &&
                                            !getBotVoiceChannel(guild)
                                        ) {

                                            await distube.voices.join(
                                                oldChannel
                                            );

                                            console.log(
                                                `🔄 24/7 REJOIN SUCCESS: ${guildId}`
                                            );
                                        }

                                    } catch (error) {

                                        console.error(
                                            `❌ 24/7 REJOIN ERROR ${guildId}:`,
                                            error.message
                                        );
                                    }

                                },
                                3000
                            );
                        }
                    }

                    return;
                }

                return;
            }


            // ==================================================
            // USER VOICE STATE
            // ==================================================

            const botChannel =
                getBotVoiceChannel(guild);

            if (!botChannel) {
                return;
            }


            // إذا 24/7 مفعّل، لا نهتم بفراغ الروم
            if (
                mode247.get(guildId)
            ) {

                clearEmptyTimer(
                    guildId
                );

                return;
            }


            // شخص رجع للروم
            if (
                newState.channelId === botChannel.id &&
                newState.member &&
                !newState.member.user.bot
            ) {

                clearEmptyTimer(
                    guildId
                );

                return;
            }


            // شخص خرج من روم البوت
            if (
                oldState.channelId === botChannel.id &&
                newState.channelId !== botChannel.id
            ) {

                if (
                    !hasHumanMembers(
                        botChannel
                    )
                ) {

                    startEmptyTimer(
                        guild
                    );
                }

                return;
            }


            // أي تغيير آخر داخل روم البوت
            if (
                oldState.channelId === botChannel.id ||
                newState.channelId === botChannel.id
            ) {

                if (
                    hasHumanMembers(
                        botChannel
                    )
                ) {

                    clearEmptyTimer(
                        guildId
                    );

                } else {

                    startEmptyTimer(
                        guild
                    );
                }
            }

        } catch (error) {

            console.error(
                '❌ VOICE STATE ERROR:',
                error
            );
        }
    }
);


// ======================================================
// CLIENT ERRORS
// ======================================================

client.on(
    'error',
    error => {

        console.error(
            '❌ DISCORD CLIENT ERROR:',
            error
        );
    }
);


// ======================================================
// WARNINGS
// ======================================================

client.on(
    'warn',
    warning => {

        console.warn(
            '⚠️ DISCORD WARNING:',
            warning
        );
    }
);


// ======================================================
// PROCESS ERRORS
// ======================================================

process.on(
    'unhandledRejection',
    error => {

        console.error(
            '❌ UNHANDLED REJECTION:',
            error
        );
    }
);


process.on(
    'uncaughtException',
    error => {

        console.error(
            '❌ UNCAUGHT EXCEPTION:',
            error
        );
    }
);


// ======================================================
// LOGIN
// ======================================================

client.login(
    TOKEN
);
