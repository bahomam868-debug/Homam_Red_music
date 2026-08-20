'use strict';

// ======================================================
// 🔴 RED MUSIC
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
const PORT = Number(process.env.PORT) || 3000;
const PREFIX = '5';

const EMPTY_LEAVE_DELAY = 5 * 60 * 1000;
const PANEL_UPDATE_INTERVAL = 10 * 1000;

// ======================================================
// TOKEN CHECK
// ======================================================

if (!TOKEN) {
    console.error('❌ TOKEN environment variable is missing.');
    process.exit(1);
}

// ======================================================
// EXPRESS
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌍 Web server listening on port ${PORT}`);
});

// ======================================================
// DISCORD CLIENT
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
    plugins: [
        new SoundCloudPlugin(),
        new YtDlpPlugin({
            update: true
        })
    ]
});

// ======================================================
// MEMORY
// ======================================================

const musicChannels = new Map();
const musicPanels = new Map();
const mode247 = new Map();
const manualLeave = new Set();
const emptyTimers = new Map();
const savedPlaylists = new Map();

// ======================================================
// START LOG
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
    const value = Number(seconds);

    if (!Number.isFinite(value)) {
        return '00:00';
    }

    const total = Math.max(0, Math.floor(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function createProgressBar(current, total) {
    const length = 20;
    const now = Number(current);
    const max = Number(total);

    if (!Number.isFinite(max) || max <= 0) {
        return '━━━━━━━━━━━━━━━━━━━━';
    }

    const percent = Math.max(
        0,
        Math.min(now / max, 1)
    );

    const position = Math.min(
        length - 1,
        Math.floor(percent * length)
    );

    return Array.from(
        { length },
        (_, i) => i === position ? '🔴' : '▬'
    ).join('');
}

function getLoopText(queue) {
    switch (queue?.repeatMode) {
        case 1:
            return 'TRACK';
        case 2:
            return 'QUEUE';
        default:
            return 'OFF';
    }
}

function getSongRequester(song) {
    return song?.user ? `${song.user}` : 'Unknown';
}

function getMusicChannel(guildId) {
    return musicChannels.get(guildId);
}

function setMusicChannel(guildId, channel) {
    if (guildId && channel) {
        musicChannels.set(guildId, channel);
    }
}

function getBotVoiceChannel(guild) {
    return guild?.members?.me?.voice?.channel || null;
}

function isInVoice(member) {
    return Boolean(member?.voice?.channel);
}

function sameVoiceAsBot(member, guild) {
    const userChannel = member?.voice?.channel;
    const botChannel = getBotVoiceChannel(guild);

    if (!userChannel) return false;
    if (!botChannel) return true;

    return userChannel.id === botChannel.id;
}

function hasHumanMembers(channel) {
    return Boolean(
        channel?.members?.some(
            member => !member.user.bot
        )
    );
}

function clearEmptyTimer(guildId) {
    const timer = emptyTimers.get(guildId);

    if (!timer) return;

    clearTimeout(timer);
    emptyTimers.delete(guildId);

    console.log(`⏱️ EMPTY TIMER CANCELLED: ${guildId}`);
}

// ======================================================
// EMBEDS
// ======================================================

function redEmbed() {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setAuthor({
            name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
        });
}

function getAddedSongEmbed(song) {
    return redEmbed()
        .setDescription(
            `➕ **تمت إضافة الأغنية إلى التشغيل**\n\n` +
            `🎵 **${song.name}**\n` +
            `⏱️ \`${song.formattedDuration || formatTime(song.duration)}\``
        )
        .setFooter({
            text: 'RED MUSIC • Music System'
        });
}

function getPingEmbed() {
    const ping = client.ws.ping;

    return redEmbed()
        .setTitle('🏓 PONG!')
        .setDescription(
            `🤖 **Bot Ping:** \`${ping}ms\`\n` +
            `🌐 **API Ping:** \`${ping}ms\``
        )
        .setFooter({
            text: 'RED MUSIC • System'
        });
}

function getCommandListEmbed() {
    return redEmbed()
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

// ======================================================
// MUSIC PANEL
// ======================================================

function getMusicPanel(song, queue) {
    const current = Number(queue?.currentTime) || 0;
    const total = Number(song?.duration) || 0;

    const progress = createProgressBar(
        current,
        total
    );

    const currentTime = formatTime(current);
    const totalTime =
        song?.formattedDuration ||
        formatTime(total);

    const embed = redEmbed()
        .setTitle('🎧 NOW PLAYING')
        .setDescription(
            `🎵 **${song?.name || 'Unknown Song'}**\n\n` +
            `\`${progress}\`\n` +
            `**${currentTime}** ━━━━━━━━━ **${totalTime}**`
        )
        .setThumbnail(
            song?.thumbnail ||
            'https://i.imgur.com/83812f.png'
        )
        .addFields(
            {
                name: '👤 REQUESTED BY',
                value: getSongRequester(song),
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

    const row1 = new ActionRowBuilder().addComponents(
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

    const row2 = new ActionRowBuilder().addComponents(
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

    const row3 = new ActionRowBuilder().addComponents(
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
        components: [row1, row2, row3]
    };
}

// ======================================================
// VOICE MESSAGES
// ======================================================

async function sendJoinMessage(channel) {
    if (!channel) return;

    await channel.send({
        embeds: [
            redEmbed()
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
    const channel = getMusicChannel(guildId);
    if (!channel) return;

    await channel.send({
        embeds: [
            redEmbed()
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
    const channel = getMusicChannel(guildId);
    if (!channel) return;

    await channel.send({
        embeds: [
            redEmbed()
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
// PANEL FUNCTIONS
// ======================================================

async function deleteMusicPanel(guildId) {
    const panel = musicPanels.get(guildId);
    if (!panel) return;

    try {
        await panel.message.delete();
    } catch {}

    musicPanels.delete(guildId);
}

async function createMusicPanel(queue, song) {
    if (!queue || !song) return null;

    const guildId = queue.id;
    const channel =
        getMusicChannel(guildId) ||
        queue.textChannel;

    if (!channel) {
        console.log(`❌ PANEL CHANNEL NOT FOUND: ${guildId}`);
        return null;
    }

    setMusicChannel(guildId, channel);

    await deleteMusicPanel(guildId);

    try {
        const message = await channel.send(
            getMusicPanel(song, queue)
        );

        musicPanels.set(guildId, {
            message,
            channel
        });

        console.log(`🎛️ PANEL CREATED: ${guildId}`);

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
    const panel = musicPanels.get(guildId);
    if (!panel?.message) return;

    const queue = distube.getQueue(guildId);

    if (!queue?.songs?.length) return;

    try {
        await panel.message.edit(
            getMusicPanel(
                queue.songs[0],
                queue
            )
        );
    } catch (error) {
        if (error?.code === 10008) {
            musicPanels.delete(guildId);
        }
    }
}

// ======================================================
// VOICE LEAVE
// ======================================================

async function leaveGuildVoice(guild, sendMessage = false) {
    if (!guild) return;

    const guildId = guild.id;

    clearEmptyTimer(guildId);

    try {
        const queue = distube.getQueue(guildId);
        if (queue) await queue.stop().catch(() => {});
    } catch {}

    try {
        distube.voices.leave(guildId);
    } catch {}

    await deleteMusicPanel(guildId);

    if (sendMessage) {
        await sendLeaveMessage(guildId);
    }
}

// ======================================================
// EMPTY VOICE TIMER
// ======================================================

function startEmptyTimer(guild) {
    if (!guild) return;

    const guildId = guild.id;

    if (mode247.get(guildId)) return;

    const channel = getBotVoiceChannel(guild);

    if (!channel) return;

    if (hasHumanMembers(channel)) {
        clearEmptyTimer(guildId);
        return;
    }

    if (emptyTimers.has(guildId)) return;

    console.log(
        `⏱️ EMPTY ROOM: ${guildId} - leaving in 5 minutes`
    );

    const timer = setTimeout(async () => {
        emptyTimers.delete(guildId);

        const currentChannel =
            getBotVoiceChannel(guild);

        if (!currentChannel) return;

        if (mode247.get(guildId)) return;

        if (hasHumanMembers(currentChannel)) {
            console.log(
                `👤 USER RETURNED - BOT STAYS: ${guildId}`
            );
            return;
        }

        console.log(
            `🚪 5 MINUTES FINISHED - LEAVING: ${guildId}`
        );

        await leaveGuildVoice(guild, true);
    }, EMPTY_LEAVE_DELAY);

    emptyTimers.set(guildId, timer);
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

    if (!query?.trim()) {
        throw new Error(
            'اكتب اسم الأغنية أو جزءاً من اسمها أو الرابط.'
        );
    }

    const guildId = voiceChannel.guild.id;

    setMusicChannel(
        guildId,
        textChannel
    );

    clearEmptyTimer(guildId);

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
// PLAYLISTS
// ======================================================

function getGuildPlaylists(guildId) {
    if (!savedPlaylists.has(guildId)) {
        savedPlaylists.set(
            guildId,
            new Map()
        );
    }

    return savedPlaylists.get(guildId);
}

function createPlaylist(guildId, name) {
    const lists = getGuildPlaylists(guildId);
    const clean = name?.trim();
    const key = clean?.toLowerCase();

    if (!key) {
        throw new Error('اكتب اسم القائمة.');
    }

    if (lists.has(key)) {
        throw new Error('هذه القائمة موجودة مسبقاً.');
    }

    const playlist = {
        name: clean,
        songs: []
    };

    lists.set(key, playlist);
    return playlist;
}

function addToPlaylist(guildId, name, song) {
    const lists = getGuildPlaylists(guildId);
    const playlist =
        lists.get(name?.trim().toLowerCase());

    if (!playlist) {
        throw new Error(
            'القائمة غير موجودة. أنشئها أولاً.'
        );
    }

    if (!song?.trim()) {
        throw new Error('اكتب اسم الأغنية.');
    }

    playlist.songs.push(song.trim());
    return playlist;
}

async function playPlaylist({
    guildId,
    voiceChannel,
    textChannel,
    member,
    playlist
}) {
    if (!playlist?.songs?.length) {
        throw new Error('القائمة فارغة.');
    }

    setMusicChannel(
        guildId,
        textChannel
    );

    clearEmptyTimer(guildId);

    for (const song of playlist.songs) {
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
// SLASH COMMANDS
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
                    .setDescription('اسم الأغنية أو الرابط')
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
    ].map(command => command.toJSON());
}

// ======================================================
// READY
// ======================================================

client.once('clientReady', async () => {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ ${client.user.tag} ONLINE`);
    console.log(`🆔 ${client.user.id}`);
    console.log('🎵 DisTube 5 READY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const rest = new REST({
        version: '10'
    }).setToken(TOKEN);

    const commands = getCommands();

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [] }
        );

        console.log('🧹 OLD GLOBAL COMMANDS CLEARED');

        for (const guild of client.guilds.cache.values()) {
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
                    `❌ COMMAND REGISTER ERROR ${guild.id}:`,
                    error.message
                );
            }
        }

        console.log('');
        console.log(
            `✅ ${commands.length} SLASH COMMANDS READY`
        );
        console.log('⚡ Prefix: 5');
        console.log('🎛️ Control Panel: READY');
        console.log('⏱️ Empty Room Timeout: 5 MINUTES');
        console.log('🔴 24/7: READY');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
        console.error(
            '❌ COMMAND REGISTRATION ERROR:',
            error
        );
    }
});
// ======================================================
// DISTUBE EVENTS
// ======================================================

distube.on('initQueue', queue => {
    console.log(`✅ QUEUE CREATED: ${queue.id}`);

    if (queue.textChannel) {
        setMusicChannel(queue.id, queue.textChannel);
    }
});

distube.on('addSong', async (queue, song) => {
    console.log(`➕ ADD SONG: ${song.name}`);

    if (queue.textChannel) {
        setMusicChannel(queue.id, queue.textChannel);
    }

    clearEmptyTimer(queue.id);

    const channel =
        getMusicChannel(queue.id) ||
        queue.textChannel;

    if (!channel) return;

    await channel.send({
        embeds: [getAddedSongEmbed(song)]
    }).catch(() => {});
});

distube.on('playSong', async (queue, song) => {
    console.log(`▶️ PLAY SONG: ${song.name}`);

    clearEmptyTimer(queue.id);

    if (queue.textChannel) {
        setMusicChannel(queue.id, queue.textChannel);
    }

    await createMusicPanel(queue, song);
});

distube.on('finishSong', async queue => {
    await updateMusicPanel(queue.id);
});

distube.on('finish', async queue => {
    console.log(`🏁 QUEUE FINISHED: ${queue.id}`);

    const guild = client.guilds.cache.get(queue.id);
    if (!guild || mode247.get(queue.id)) return;

    const channel = getBotVoiceChannel(guild);

    if (channel && !hasHumanMembers(channel)) {
        startEmptyTimer(guild);
    }
});

distube.on('disconnect', queue => {
    const guild = client.guilds.cache.get(queue.id);
    if (!guild || manualLeave.has(queue.id)) return;

    console.log(`⚠️ DISTUBE DISCONNECT: ${queue.id}`);

    if (!mode247.get(queue.id)) return;

    const channel = getBotVoiceChannel(guild);

    if (!channel) return;

    setTimeout(async () => {
        try {
            if (
                mode247.get(queue.id) &&
                !getBotVoiceChannel(guild)
            ) {
                await distube.voices.join(channel);
                console.log(`🔄 24/7 RECONNECTED: ${queue.id}`);
            }
        } catch (error) {
            console.error(
                `❌ 24/7 RECONNECT ERROR ${queue.id}:`,
                error.message
            );
        }
    }, 3000);
});

distube.on('deleteQueue', queue => {
    console.log(`🗑️ QUEUE DELETED: ${queue.id}`);
});

distube.on('error', async (error, queue, song) => {
    console.error('❌ DISTUBE ERROR:', error);

    const guildId = queue?.id;
    if (!guildId) return;

    const channel =
        getMusicChannel(guildId) ||
        queue?.textChannel;

    if (!channel) return;

    const songName =
        song?.name ||
        queue?.songs?.[0]?.name ||
        'Unknown Song';

    await channel.send({
        embeds: [
            redEmbed()
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
});


// ======================================================
// PANEL AUTO UPDATE
// ======================================================

setInterval(async () => {
    for (const guildId of musicPanels.keys()) {
        try {
            await updateMusicPanel(guildId);
        } catch (error) {
            console.error(
                `❌ PANEL TIMER ERROR ${guildId}:`,
                error.message
            );
        }
    }
}, PANEL_UPDATE_INTERVAL);


// ======================================================
// PREFIX COMMANDS
// ======================================================

client.on('messageCreate', async message => {
    try {
        if (
            message.author.bot ||
            !message.guild ||
            !message.content.startsWith(PREFIX)
        ) return;

        const raw = message.content.slice(PREFIX.length).trim();
        if (!raw) return;

        const args = raw.split(/\s+/);
        const command = args.shift()?.toLowerCase();
        const voiceChannel = message.member?.voice?.channel;

        if (command === 'command') {
            return message.reply({
                embeds: [getCommandListEmbed()]
            });
        }

        if (command === 'ping') {
            return message.reply({
                embeds: [getPingEmbed()]
            });
        }

        if (command === 'p' || command === 'play') {
            if (!voiceChannel) {
                return message.reply(
                    '❌ يجب أن تكون في روم صوتي أولاً.'
                );
            }

            const query = args.join(' ').trim();

            if (!query) {
                return message.reply(
                    '❌ اكتب اسم الأغنية أو الرابط.'
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
                console.error('❌ PREFIX PLAY:', error);

                return message.reply(
                    `❌ لم أستطع تشغيل الأغنية.\n> ${String(error?.message || 'Unknown error').slice(0, 1500)}`
                ).catch(() => {});
            }

            return;
        }

        if (command === 'join') {
            if (!voiceChannel) {
                return message.reply(
                    '❌ يجب أن تكون في روم صوتي.'
                );
            }

            setMusicChannel(
                message.guildId,
                message.channel
            );

            clearEmptyTimer(message.guildId);

            try {
                await distube.voices.join(voiceChannel);
                await sendJoinMessage(message.channel);

                return message.reply(
                    '✅ تم دخول الروم الصوتي.'
                );
            } catch (error) {
                console.error('❌ JOIN:', error);

                return message.reply(
                    '❌ لم أستطع دخول الروم الصوتي.'
                );
            }
        }

        if (command === 'leave') {
            const guildId = message.guildId;

            mode247.set(guildId, false);
            manualLeave.add(guildId);
            clearEmptyTimer(guildId);

            await leaveGuildVoice(message.guild, true);

            setTimeout(
                () => manualLeave.delete(guildId),
                5000
            );

            return message.reply(
                '👋 تم إخراج RED MUSIC من الروم.'
            );
        }

        if (command === 'stop') {
            const queue = distube.getQueue(message.guildId);

            if (!queue) {
                return message.reply(
                    '❌ لا توجد موسيقى تعمل حالياً.'
                );
            }

            try {
                await queue.stop();
            } catch {}

            await deleteMusicPanel(message.guildId);
            await sendStopMessage(message.guildId);

            return message.reply(
                '⏹️ تم إيقاف الموسيقى.'
            );
        }

        if (command === 'skip') {
            const queue = distube.getQueue(message.guildId);

            if (!queue) {
                return message.reply(
                    '❌ لا توجد موسيقى.'
                );
            }

            try {
                await queue.skip();
                return message.reply('⏭️ تم تخطي الأغنية.');
            } catch {
                return message.reply(
                    '❌ لا توجد أغنية أخرى.'
                );
            }
        }

        if (command === 'pause' || command === 'resume') {
            const queue = distube.getQueue(message.guildId);

            if (!queue) {
                return message.reply(
                    '❌ لا توجد موسيقى.'
                );
            }

            try {
                if (command === 'pause') {
                    await queue.pause();
                    await updateMusicPanel(message.guildId);
                    return message.reply('⏸️ تم إيقاف الموسيقى مؤقتاً.');
                }

                await queue.resume();
                await updateMusicPanel(message.guildId);
                return message.reply('▶️ تم استئناف الموسيقى.');
            } catch {
                return message.reply(
                    '❌ تعذر تنفيذ الأمر.'
                );
            }
        }

        if (command === '247') {
            const guildId = message.guildId;
            const enabled = mode247.get(guildId) === true;

            if (enabled) {
                mode247.set(guildId, false);

                const channel =
                    getBotVoiceChannel(message.guild);

                if (channel && !hasHumanMembers(channel)) {
                    startEmptyTimer(message.guild);
                }

                return message.reply({
                    embeds: [
                        redEmbed().setDescription(
                            `🔴 **RED MUSIC 24/7**\n\n` +
                            `الحالة: **متوقف ❌**\n\n` +
                            `⏱️ إذا كان الروم فارغاً سيخرج البوت بعد **5 دقائق**.`
                        )
                    ]
                });
            }

            if (!voiceChannel) {
                return message.reply(
                    '❌ يجب أن تكون في روم صوتي حتى تفعل 24/7.'
                );
            }

            mode247.set(guildId, true);
            setMusicChannel(guildId, message.channel);
            clearEmptyTimer(guildId);

            try {
                await distube.voices.join(voiceChannel);
            } catch (error) {
                mode247.set(guildId, false);

                return message.reply(
                    '❌ لم أستطع دخول الروم لتفعيل 24/7.'
                );
            }

            return message.reply({
                embeds: [
                    redEmbed().setDescription(
                        `🔴 **RED MUSIC 24/7**\n\n` +
                        `الحالة: **مفعّل ✅**\n\n` +
                        `🎧 البوت سيبقى في الروم حتى تقوم بإيقاف **24/7**.`
                    )
                ]
            });
        }

        if (command === 'seek') {
            const seconds = Number(args[0]);
            const queue = distube.getQueue(message.guildId);

            if (!Number.isFinite(seconds) || seconds < 0) {
                return message.reply(
                    '❌ اكتب عدد ثواني صحيح.'
                );
            }

            if (!queue) {
                return message.reply(
                    '❌ لا توجد أغنية تعمل.'
                );
            }

            try {
                await queue.seek(seconds);
                await updateMusicPanel(message.guildId);

                return message.reply(
                    `⏩ تم الانتقال إلى \`${formatTime(seconds)}\`.`
                );
            } catch {
                return message.reply(
                    '❌ لا يمكن الانتقال لهذا الوقت.'
                );
            }
        }

        if (command === 'list') {
            const sub = args.shift()?.toLowerCase();

            if (!sub) {
                return message.reply(
                    '❌ استخدم: `5list create` أو `5list add` أو `5list show` أو `5list play`'
                );
            }

            if (sub === 'create') {
                const name = args.join(' ').trim();

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

            if (sub === 'add') {
                const name = args.shift();
                const song = args.join(' ').trim();

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

            if (sub === 'show') {
                const lists =
                    getGuildPlaylists(message.guildId);

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
                        redEmbed()
                            .setAuthor({
                                name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • LISTS'
                            })
                            .setTitle('📋 قوائمك')
                            .setDescription(text)
                    ]
                });
            }

            if (sub === 'play') {
                if (!voiceChannel) {
                    return message.reply(
                        '❌ يجب أن تكون في روم صوتي أولاً.'
                    );
                }

                const name = args.join(' ').trim();
                const playlist =
                    getGuildPlaylists(message.guildId)
                        .get(name.toLowerCase());

                if (!playlist) {
                    return message.reply(
                        '❌ القائمة غير موجودة.'
                    );
                }

                try {
                    await playPlaylist({
                        guildId: message.guildId,
                        voiceChannel,
                        textChannel: message.channel,
                        member: message.member,
                        playlist
                    });

                    return message.reply(
                        `▶️ تم تشغيل قائمة **${playlist.name}**.`
                    );
                } catch (error) {
                    console.error('❌ PLAYLIST:', error);

                    return message.reply(
                        '❌ حدث خطأ أثناء تشغيل القائمة.'
                    );
                }
            }
        }

    } catch (error) {
        console.error('❌ MESSAGE COMMAND ERROR:', error);
    }
});


// ======================================================
// INTERACTIONS
// ======================================================

client.on('interactionCreate', async interaction => {
    try {
        // ==================================================
        // SLASH COMMANDS
        // ==================================================

        if (interaction.isChatInputCommand()) {
            const command = interaction.commandName;
            const guild = interaction.guild;
            const guildId = interaction.guildId;
            const member = interaction.member;
            const voiceChannel = member?.voice?.channel;

            if (command === 'command') {
                return interaction.reply({
                    embeds: [getCommandListEmbed()],
                    ephemeral: true
                });
            }

            if (command === 'ping') {
                return interaction.reply({
                    embeds: [getPingEmbed()]
                });
            }

            if (command === 'play') {
                if (!voiceChannel) {
                    return interaction.reply({
                        content:
                            '❌ يجب أن تكون في روم صوتي أولاً.',
                        ephemeral: true
                    });
                }

                const query =
                    interaction.options.getString('song');

                await interaction.deferReply({
                    ephemeral: true
                });

                try {
                    await playMusic({
                        voiceChannel,
                        query,
                        textChannel: interaction.channel,
                        member
                    });

                    return interaction.editReply({
                        content:
                            '✅ تم إرسال الأغنية إلى RED MUSIC.'
                    });
                } catch (error) {
                    console.error('❌ SLASH PLAY:', error);

                    return interaction.editReply({
                        content:
                            `❌ لم أستطع تشغيل الأغنية.\n> ${String(error?.message || 'Unknown error').slice(0, 1500)}`
                    });
                }
            }

            if (command === 'playlist' || command === 'lista') {
                const queue = distube.getQueue(guildId);

                if (!queue?.songs?.length) {
                    return interaction.reply({
                        content:
                            '❌ القائمة فارغة حالياً.',
                        ephemeral: true
                    });
                }

                const list = queue.songs
                    .slice(0, 20)
                    .map(
                        (song, i) =>
                            `**${i + 1}.** 🎵 ${song.name}\n` +
                            `└ ⏱️ \`${song.formattedDuration || formatTime(song.duration)}\``
                    )
                    .join('\n\n');

                return interaction.reply({
                    embeds: [
                        redEmbed()
                            .setAuthor({
                                name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • PLAYLIST'
                            })
                            .setTitle('📋 قائمة التشغيل')
                            .setDescription(list)
                            .setFooter({
                                text: `${queue.songs.length} Songs`
                            })
                    ],
                    ephemeral: true
                });
            }

            if (command === 'list') {
                const sub =
                    interaction.options.getSubcommand();

                if (sub === 'create') {
                    try {
                        const playlist =
                            createPlaylist(
                                guildId,
                                interaction.options.getString('name')
                            );

                        return interaction.reply({
                            content:
                                `✅ تم إنشاء قائمة **${playlist.name}**.`,
                            ephemeral: true
                        });
                    } catch (error) {
                        return interaction.reply({
                            content: `❌ ${error.message}`,
                            ephemeral: true
                        });
                    }
                }

                if (sub === 'add') {
                    try {
                        const playlist =
                            addToPlaylist(
                                guildId,
                                interaction.options.getString('name'),
                                interaction.options.getString('song')
                            );

                        return interaction.reply({
                            content:
                                `✅ تمت إضافة الأغنية إلى قائمة **${playlist.name}**.`,
                            ephemeral: true
                        });
                    } catch (error) {
                        return interaction.reply({
                            content: `❌ ${error.message}`,
                            ephemeral: true
                        });
                    }
                }

                if (sub === 'show') {
                    const lists =
                        getGuildPlaylists(guildId);

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
                            redEmbed()
                                .setAuthor({
                                    name:
                                        '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • LISTS'
                                })
                                .setTitle('📋 القوائم المحفوظة')
                                .setDescription(text)
                        ],
                        ephemeral: true
                    });
                }

                if (sub === 'play') {
                    if (!voiceChannel) {
                        return interaction.reply({
                            content:
                                '❌ يجب أن تكون في روم صوتي أولاً.',
                            ephemeral: true
                        });
                    }

                    const name =
                        interaction.options.getString('name');

                    const playlist =
                        getGuildPlaylists(guildId)
                            .get(name.toLowerCase());

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
                            textChannel: interaction.channel,
                            member,
                            playlist
                        });

                        return interaction.editReply({
                            content:
                                `▶️ تم تشغيل قائمة **${playlist.name}**.`
                        });
                    } catch (error) {
                        console.error('❌ SLASH PLAYLIST:', error);

                        return interaction.editReply({
                            content:
                                '❌ حدث خطأ أثناء تشغيل القائمة.'
                        });
                    }
                }
            }

            if (command === 'join') {
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

                clearEmptyTimer(guildId);

                try {
                    await distube.voices.join(voiceChannel);
                    await sendJoinMessage(interaction.channel);

                    return interaction.reply({
                        content:
                            '✅ تم دخول الروم الصوتي.',
                        ephemeral: true
                    });
                } catch {
                    return interaction.reply({
                        content:
                            '❌ لم أستطع دخول الروم.',
                        ephemeral: true
                    });
                }
            }

            if (command === 'leave') {
                mode247.set(guildId, false);
                manualLeave.add(guildId);
                clearEmptyTimer(guildId);

                await leaveGuildVoice(guild, true);

                setTimeout(
                    () => manualLeave.delete(guildId),
                    5000
                );

                return interaction.reply({
                    content:
                        '👋 تم إخراج RED MUSIC من الروم.',
                    ephemeral: true
                });
            }

            if (command === 'stop') {
                const queue = distube.getQueue(guildId);

                if (!queue) {
                    return interaction.reply({
                        content:
                            '❌ لا توجد موسيقى.',
                        ephemeral: true
                    });
                }

                try {
                    await queue.stop();
                } catch {}

                await deleteMusicPanel(guildId);
                await sendStopMessage(guildId);

                return interaction.reply({
                    content:
                        '⏹️ تم إيقاف الموسيقى.',
                    ephemeral: true
                });
            }

            if (command === 'skip') {
                const queue = distube.getQueue(guildId);

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

            if (command === 'pause' || command === 'resume') {
                const queue = distube.getQueue(guildId);

                if (!queue) {
                    return interaction.reply({
                        content:
                            '❌ لا توجد موسيقى.',
                        ephemeral: true
                    });
                }

                try {
                    if (command === 'pause') {
                        await queue.pause();
                        await updateMusicPanel(guildId);

                        return interaction.reply({
                            content:
                                '⏸️ تم إيقاف الموسيقى مؤقتاً.',
                            ephemeral: true
                        });
                    }

                    await queue.resume();
                    await updateMusicPanel(guildId);

                    return interaction.reply({
                        content:
                            '▶️ تم استئناف الموسيقى.',
                        ephemeral: true
                    });
                } catch {
                    return interaction.reply({
                        content:
                            '❌ تعذر تنفيذ الأمر.',
                        ephemeral: true
                    });
                }
            }

            if (command === 'seek') {
                const seconds =
                    interaction.options.getInteger('seconds');

                const queue = distube.getQueue(guildId);

                if (!queue) {
                    return interaction.reply({
                        content:
                            '❌ لا توجد أغنية.',
                        ephemeral: true
                    });
                }

                try {
                    await queue.seek(seconds);
                    await updateMusicPanel(guildId);

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

            if (command === '247') {
                const enabled =
                    mode247.get(guildId) === true;

                if (enabled) {
                    mode247.set(guildId, false);

                    const channel =
                        getBotVoiceChannel(guild);

                    if (
                        channel &&
                        !hasHumanMembers(channel)
                    ) {
                        startEmptyTimer(guild);
                    }

                    return interaction.reply({
                        embeds: [
                            redEmbed().setDescription(
                                `🔴 **RED MUSIC 24/7**\n\n` +
                                `الحالة: **متوقف ❌**\n\n` +
                                `⏱️ إذا كان الروم فارغاً سيخرج البوت بعد **5 دقائق**.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                if (!voiceChannel) {
                    return interaction.reply({
                        content:
                            '❌ يجب أن تكون في روم صوتي حتى تفعل 24/7.',
                        ephemeral: true
                    });
                }

                mode247.set(guildId, true);
                setMusicChannel(guildId, interaction.channel);
                clearEmptyTimer(guildId);

                try {
                    await distube.voices.join(voiceChannel);
                } catch {
                    mode247.set(guildId, false);

                    return interaction.reply({
                        content:
                            '❌ لم أستطع دخول الروم.',
                        ephemeral: true
                    });
                }

                return interaction.reply({
                    embeds: [
                        redEmbed().setDescription(
                            `🔴 **RED MUSIC 24/7**\n\n` +
                            `الحالة: **مفعّل ✅**\n\n` +
                            `🎧 لن يخرج البوت تلقائياً حتى تقوم بإيقاف **24/7**.`
                        )
                    ],
                    ephemeral: true
                });
            }
        }


        // ==================================================
        // BUTTONS
        // ==================================================

        if (interaction.isButton()) {
            const guild = interaction.guild;
            const guildId = interaction.guildId;
            const member = interaction.member;
            const id = interaction.customId;

            if (!isInVoice(member)) {
                return interaction.reply({
                    content:
                        '❌ يجب أن تكون داخل روم صوتي حتى تتحكم بالموسيقى.',
                    ephemeral: true
                });
            }

            if (
                getBotVoiceChannel(guild) &&
                !sameVoiceAsBot(member, guild)
            ) {
                return interaction.reply({
                    content:
                        '❌ يجب أن تكون في نفس الروم الصوتي مع RED MUSIC.',
                    ephemeral: true
                });
            }

            const queue = distube.getQueue(guildId);

            if (!queue) {
                return interaction.reply({
                    content:
                        '❌ لا توجد موسيقى تعمل حالياً.',
                    ephemeral: true
                });
            }

            if (id === 'btn_prev') {
                try {
                    await interaction.deferUpdate();
                    await queue.previous();
                    await updateMusicPanel(guildId);
                } catch {
                    await interaction.followUp({
                        content:
                            '❌ لا توجد أغنية سابقة.',
                        ephemeral: true
                    }).catch(() => {});
                }
                return;
            }

            if (
                id === 'btn_back10' ||
                id === 'btn_forward10' ||
                id === 'btn_back30' ||
                id === 'btn_forward30'
            ) {
                await interaction.deferUpdate();

                const current =
                    Number(queue.currentTime) || 0;

                const duration =
                    Number(queue.songs[0]?.duration) || 0;

                const amount =
                    id === 'btn_back10'
                        ? -10
                        : id === 'btn_forward10'
                            ? 10
                            : id === 'btn_back30'
                                ? -30
                                : 30;

                await queue.seek(
                    Math.max(
                        0,
                        Math.min(
                            duration || Infinity,
                            current + amount
                        )
                    )
                );

                await updateMusicPanel(guildId);
                return;
            }

            if (id === 'btn_pause') {
                await interaction.deferUpdate();

                if (!queue.paused) {
                    await queue.pause();
                }

                await updateMusicPanel(guildId);
                return;
            }

            if (id === 'btn_resume') {
                await interaction.deferUpdate();

                if (queue.paused) {
                    await queue.resume();
                }

                await updateMusicPanel(guildId);
                return;
            }

            if (id === 'btn_skip') {
                await interaction.deferUpdate();

                try {
                    await queue.skip();
                } catch {}

                return;
            }

            if (id === 'btn_loop') {
                await interaction.deferUpdate();

                try {
                    queue.setRepeatMode();
                    await updateMusicPanel(guildId);
                } catch {}

                return;
            }

            if (id === 'btn_shuffle') {
                await interaction.deferUpdate();

                try {
                    await queue.shuffle();
                    await updateMusicPanel(guildId);
                } catch {}

                return;
            }

            if (id === 'btn_queue') {
                const list = queue.songs
                    .slice(0, 20)
                    .map(
                        (song, i) =>
                            `**${i + 1}.** 🎵 ${song.name}\n` +
                            `└ ⏱️ \`${song.formattedDuration || formatTime(song.duration)}\``
                    )
                    .join('\n\n');

                return interaction.reply({
                    embeds: [
                        redEmbed()
                            .setAuthor({
                                name:
                                    '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • QUEUE'
                            })
                            .setTitle('📋 قائمة التشغيل')
                            .setDescription(
                                list || 'القائمة فارغة.'
                            )
                            .setFooter({
                                text:
                                    `${queue.songs.length} Songs`
                            })
                    ],
                    ephemeral: true
                });
            }

            if (id === 'btn_stop') {
                await interaction.deferUpdate();

                try {
                    await queue.stop();
                } catch {}

                await deleteMusicPanel(guildId);
                await sendStopMessage(guildId);
                return;
            }

            if (
                id === 'btn_voldown' ||
                id === 'btn_volup'
            ) {
                await interaction.deferUpdate();

                const current =
                    Number(queue.volume) || 100;

                const volume =
                    id === 'btn_voldown'
                        ? Math.max(0, current - 10)
                        : Math.min(100, current + 10);

                queue.setVolume(volume);
                await updateMusicPanel(guildId);
                return;
            }
        }

    } catch (error) {
        console.error('❌ INTERACTION ERROR:', error);

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
});


// ======================================================
// VOICE STATE
// ======================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild ||
                oldState.guild;

            if (!guild) return;

            const guildId = guild.id;

            // ----------------------------------------------
            // BOT VOICE
            // ----------------------------------------------

            if (
                oldState.member?.id === client.user.id ||
                newState.member?.id === client.user.id
            ) {
                if (
                    oldState.channelId &&
                    !newState.channelId
                ) {
                    console.log(
                        `🚪 BOT LEFT VOICE: ${guildId}`
                    );

                    clearEmptyTimer(guildId);

                    if (
                        mode247.get(guildId) &&
                        !manualLeave.has(guildId)
                    ) {
                        const oldChannel =
                            oldState.channel;

                        if (oldChannel) {
                            setTimeout(async () => {
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
                            }, 3000);
                        }
                    }
                }

                return;
            }

            // ----------------------------------------------
            // USERS
            // ----------------------------------------------

            const botChannel =
                getBotVoiceChannel(guild);

            if (!botChannel) return;

            if (mode247.get(guildId)) {
                clearEmptyTimer(guildId);
                return;
            }

            if (
                newState.channelId === botChannel.id &&
                newState.member &&
                !newState.member.user.bot
            ) {
                clearEmptyTimer(guildId);
                return;
            }

            if (
                oldState.channelId === botChannel.id &&
                newState.channelId !== botChannel.id &&
                !hasHumanMembers(botChannel)
            ) {
                startEmptyTimer(guild);
                return;
            }

            if (
                oldState.channelId === botChannel.id ||
                newState.channelId === botChannel.id
            ) {
                if (hasHumanMembers(botChannel)) {
                    clearEmptyTimer(guildId);
                } else {
                    startEmptyTimer(guild);
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
// ERROR HANDLING
// ======================================================

client.on('error', error => {
    console.error(
        '❌ DISCORD CLIENT ERROR:',
        error
    );
});

client.on('warn', warning => {
    console.warn(
        '⚠️ DISCORD WARNING:',
        warning
    );
});

process.on('unhandledRejection', error => {
    console.error(
        '❌ UNHANDLED REJECTION:',
        error
    );
});

process.on('uncaughtException', error => {
    console.error(
        '❌ UNCAUGHT EXCEPTION:',
        error
    );
});


// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN)
    .then(() => {
        console.log('🔐 LOGIN REQUEST SENT');
    })
    .catch(error => {
        console.error(
            '❌ LOGIN FAILED:',
            error
        );
        process.exit(1);
    });
