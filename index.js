const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('RED MUSIC Bot is online!');
});

app.listen(PORT, () => {
    console.log(`🌍 Web server is listening on port ${PORT}`);
});


// ======================================================
// DISCORD
// ======================================================

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
    plugins: [
        new SoundCloudPlugin(),
        new YtDlpPlugin({
            update: true
        })
    ]
});


console.log('🔴 RED MUSIC');
console.log('✅ DisTube loaded successfully');
console.log('✅ SoundCloud Plugin loaded successfully');
console.log('✅ YouTube Yt-Dlp Plugin loaded successfully');

// ======================================================
// HELPERS
// ======================================================

function formatTime(seconds) {

    if (
        seconds === undefined ||
        seconds === null ||
        isNaN(seconds)
    ) {
        return '00:00';
    }

    seconds = Math.max(
        0,
        Math.floor(seconds)
    );

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return (
        String(minutes).padStart(2, '0') +
        ':' +
        String(secs).padStart(2, '0')
    );
}


function createProgressBar(current, total) {

    if (!total || total <= 0) {
        return '━━━━━━━━━━━━━━━━━━━━';
    }

    const percent = Math.max(
        0,
        Math.min(current / total, 1)
    );

    const length = 20;

    const position = Math.min(
        length - 1,
        Math.floor(percent * length)
    );

    let bar = '';

    for (let i = 0; i < length; i++) {

        bar += i === position
            ? '🔴'
            : '▬';
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

    return !!member?.voice?.channel;
}


function sameVoiceAsBot(member, guild) {

    const userChannel =
        member?.voice?.channel;

    const botChannel =
        guild?.members?.me?.voice?.channel;

    if (!userChannel) {
        return false;
    }

    if (!botChannel) {
        return true;
    }

    return userChannel.id === botChannel.id;
}


function getMusicChannel(guildId) {

    return musicChannels.get(guildId);
}


// ======================================================
// CHECK VOICE MEMBERS
// ======================================================

function hasHumanMembers(voiceChannel) {

    if (!voiceChannel) {
        return false;
    }

    return voiceChannel.members.some(
        member => !member.user.bot
    );
}


// ======================================================
// SAFE LEAVE
// ======================================================

async function leaveGuildVoice(guild) {

    if (!guild) {
        return;
    }

    const guildId = guild.id;

    try {
        const queue = distube.getQueue(guildId);

        if (queue) {
            try {
                distube.stop(guildId);
            } catch {}
        }
    } catch {}

    try {
        distube.voices.leave(guild);
    } catch {}

    musicPanels.delete(guildId);
}


// ======================================================
// ADDED SONG EMBED
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


// ======================================================
// MUSIC PANEL
// ======================================================

function getMusicPanel(song, queue) {

    const currentTime =
        queue?.currentTime || 0;

    const totalTime =
        song?.duration || 0;

    const progress =
        createProgressBar(
            currentTime,
            totalTime
        );

    const embed =
        new EmbedBuilder()
            .setColor('#FF0000')
            .setAuthor({
                name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
            })
            .setTitle('🎧 NOW PLAYING')
            .setDescription(
                `🎵 **${song.name}**\n\n` +
                `\`${progress}\`\n` +
                `**${formatTime(currentTime)}** ━━━━━━━━━ **${song?.formattedDuration || formatTime(totalTime)}**`
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


// ======================================================
// UPDATE PANEL
// ======================================================

async function updateMusicPanel(guildId) {

    const panel =
        musicPanels.get(guildId);

    if (!panel) {
        return;
    }

    const queue =
        distube.getQueue(guildId);

    if (
        !queue ||
        !queue.songs ||
        !queue.songs.length
    ) {
        return;
    }

    try {

        await panel.message.edit(
            getMusicPanel(
                queue.songs[0],
                queue
            )
        );

    } catch (error) {

        console.error(
            '❌ PANEL UPDATE ERROR:',
            error.message
        );
    }
}


// ======================================================
// CREATE PANEL
// ======================================================

async function createMusicPanel(queue, song) {

    try {

        const guildId =
            queue.id;

        const channel =
            getMusicChannel(guildId) ||
            queue.textChannel;

        if (!channel) {

            console.log(
                `❌ لا توجد قناة موسيقى للسيرفر: ${guildId}`
            );

            return null;
        }

        musicChannels.set(
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


        const panel =
            await channel.send(
                getMusicPanel(
                    song,
                    queue
                )
            );


        musicPanels.set(
            guildId,
            {
                message: panel,
                channel: channel
            }
        );


        console.log(
            `🎛️ MUSIC PANEL CREATED: ${guildId}`
        );

        return panel;

    } catch (error) {

        console.error(
            '❌ PANEL CREATE ERROR:',
            error
        );

        return null;
    }
}


// ======================================================
// JOIN MESSAGE
// ======================================================

async function sendJoinMessage(channel) {

    if (!channel) {
        return;
    }

    return channel.send({
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


// ======================================================
// LEAVE MESSAGE
// ======================================================

async function sendLeaveMessage(guildId) {

    const channel =
        getMusicChannel(guildId);

    if (!channel) {
        return;
    }

    return channel.send({
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


// ======================================================
// STOP MESSAGE
// ======================================================

async function sendStopMessage(guildId) {

    const channel =
        getMusicChannel(guildId);

    if (!channel) {
        return;
    }

    return channel.send({
        embeds: [
            new EmbedBuilder()
                .setColor('#FF0000')
                .setAuthor({
                    name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
                })
                .setDescription(
                    `⏸️ **تم إيقاف الموسيقى مؤقتاً**\n\n` +
                    `▶️ يمكنك استخدام **resume** لإكمال التشغيل.`
                )
                .setFooter({
                    text: 'RED MUSIC • Music System'
                })
        ]
    }).catch(() => {});
}


// ======================================================
// PING
// ======================================================

function getPingEmbed(client) {

    const ping =
        client.ws.ping;

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
// COMMANDS
// ======================================================

function getCommands() {

    return [

        new SlashCommandBuilder()
            .setName('command')
            .setDescription(
                'عرض جميع أوامر RED MUSIC'
            ),

        new SlashCommandBuilder()
            .setName('play')
            .setDescription(
                'تشغيل أغنية بالاسم أو جزء من الاسم أو الرابط'
            )
            .addStringOption(option =>
                option
                    .setName('song')
                    .setDescription(
                        'اسم الأغنية أو جزء منها أو رابط YouTube/SoundCloud'
                    )
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('playlist')
            .setDescription(
                'عرض قائمة التشغيل الحالية'
            ),

        new SlashCommandBuilder()
            .setName('lista')
            .setDescription(
                'عرض قائمة التشغيل الحالية'
            ),

        new SlashCommandBuilder()
            .setName('list')
            .setDescription(
                'إدارة قوائم RED MUSIC'
            )

            .addSubcommand(sub =>
                sub
                    .setName('create')
                    .setDescription(
                        'إنشاء قائمة جديدة'
                    )
                    .addStringOption(option =>
                        option
                            .setName('name')
                            .setDescription(
                                'اسم القائمة'
                            )
                            .setRequired(true)
                    )
            )

            .addSubcommand(sub =>
                sub
                    .setName('add')
                    .setDescription(
                        'إضافة أغنية إلى قائمة'
                    )
                    .addStringOption(option =>
                        option
                            .setName('name')
                            .setDescription(
                                'اسم القائمة'
                            )
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('song')
                            .setDescription(
                                'اسم أو رابط الأغنية'
                            )
                            .setRequired(true)
                    )
            )

            .addSubcommand(sub =>
                sub
                    .setName('show')
                    .setDescription(
                        'عرض القوائم المحفوظة'
                    )
            )

            .addSubcommand(sub =>
                sub
                    .setName('play')
                    .setDescription(
                        'تشغيل قائمة'
                    )
                    .addStringOption(option =>
                        option
                            .setName('name')
                            .setDescription(
                                'اسم القائمة'
                            )
                            .setRequired(true)
                    )
            ),

        new SlashCommandBuilder()
            .setName('stop')
            .setDescription(
                'إيقاف الموسيقى مؤقتاً'
            ),

        new SlashCommandBuilder()
            .setName('skip')
            .setDescription(
                'تخطي الأغنية'
            ),

        new SlashCommandBuilder()
            .setName('pause')
            .setDescription(
                'إيقاف مؤقت'
            ),

        new SlashCommandBuilder()
            .setName('resume')
            .setDescription(
                'استئناف الموسيقى'
            ),

        new SlashCommandBuilder()
            .setName('join')
            .setDescription(
                'دخول الروم الصوتي'
            ),

        new SlashCommandBuilder()
            .setName('leave')
            .setDescription(
                'الخروج من الروم الصوتي'
            ),

        new SlashCommandBuilder()
            .setName('247')
            .setDescription(
                'تفعيل أو إيقاف وضع 24/7'
            ),

        new SlashCommandBuilder()
            .setName('seek')
            .setDescription(
                'تحديد مكان الأغنية'
            )
            .addIntegerOption(option =>
                option
                    .setName('seconds')
                    .setDescription(
                        'عدد الثواني'
                    )
                    .setRequired(true)
                    .setMinValue(0)
            ),

        new SlashCommandBuilder()
            .setName('ping')
            .setDescription(
                'عرض سرعة استجابة البوت'
            )

    ].map(command => command.toJSON());
}


// ======================================================
// COMMAND LIST EMBED
// ======================================================

function getCommandListEmbed() {

    return new EmbedBuilder()
        .setColor('#FF0000')
        .setAuthor({
            name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
        })
        .setTitle('📋 RED MUSIC • COMMANDS')

        .setDescription(
            `**🎵 MUSIC**\n` +
            `\`/play <song>\` — تشغيل أغنية\n\n` +

            `**📋 PLAYLIST**\n` +
            `\`/playlist\` — عرض قائمة التشغيل الحالية\n` +
            `\`/lista\` — عرض قائمة التشغيل الحالية\n` +
            `\`/list create <name>\` — إنشاء قائمة جديدة\n` +
            `\`/list add <name> <song>\` — إضافة أغنية إلى قائمة\n` +
            `\`/list show\` — عرض القوائم المحفوظة\n` +
            `\`/list play <name>\` — تشغيل قائمة\n\n` +

            `**🎧 CONTROL**\n` +
            `\`/stop\` — إيقاف الموسيقى مؤقتاً\n` +
            `\`/skip\` — تخطي الأغنية\n` +
            `\`/pause\` — إيقاف مؤقت\n` +
            `\`/resume\` — استئناف الموسيقى\n` +
            `\`/seek <seconds>\` — تحديد مكان الأغنية\n\n` +

            `**🔊 VOICE**\n` +
            `\`/join\` — دخول الروم الصوتي\n` +
            `\`/leave\` — الخروج من الروم الصوتي\n\n` +

            `**🔴 SYSTEM**\n` +
            `\`/247\` — تفعيل أو إيقاف 24/7\n` +
            `\`/ping\` — عرض سرعة استجابة البوت\n\n` +

            `**⚡ اختصارات 5**\n` +
            `\`5p\` / \`5play\` • \`5stop\` • \`5skip\` • ` +
            `\`5pause\` • \`5resume\` • \`5join\` • \`5leave\` • ` +
            `\`5ping\` • \`5command\` • \`5list\``
        )

        .setFooter({
            text: 'RED MUSIC • Music System'
        });
}


// ======================================================
// READY
// ======================================================

client.once(
    'clientReady',
    async () => {

        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔴 RED MUSIC');
        console.log(`✅ ${client.user.tag} ONLINE`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const rest =
            new REST({
                version: '10'
            }).setToken(
                process.env.TOKEN
            );

        try {

            const commands =
                getCommands();


            // تنظيف أوامر Guild القديمة
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
                            body: []
                        }
                    );

                    console.log(
                        `🧹 OLD GUILD COMMANDS CLEARED: ${guild.id}`
                    );

                } catch (error) {

                    console.error(
                        `❌ GUILD COMMAND CLEAN ERROR: ${guild.id}`,
                        error.message
                    );
                }
            }


            // تسجيل Global Commands
            await rest.put(
                Routes.applicationCommands(
                    client.user.id
                ),
                {
                    body: commands
                }
            );


            console.log(
                '🌍 GLOBAL SLASH COMMANDS REGISTERED'
            );

            console.log(
                `✅ ${commands.length} SLASH COMMANDS READY`
            );

            console.log(
                '🎵 YouTube + SoundCloud READY'
            );

            console.log(
                '⚡ Shortcuts: 5p / 5play / 5stop / 5skip / 5pause / 5resume / 5join / 5leave / 5ping / 5command / 5list'
            );

        } catch (error) {

            console.error(
                '❌ Global Slash Command Error:',
                error
            );
        }
    }
);


// ======================================================
// INIT QUEUE
// ======================================================

distube.on(
    'initQueue',
    queue => {

        console.log(
            `✅ INIT QUEUE: ${queue.id}`
        );

        if (queue.textChannel) {

            musicChannels.set(
                queue.id,
                queue.textChannel
            );
        }
    }
);


// ======================================================
// ADD SONG
// ======================================================

distube.on(
    'addSong',
    async (queue, song) => {

        try {

            const guildId =
                queue.id;

            console.log(
                `➕ ADD SONG: ${song.name}`
            );


            const channel =
                getMusicChannel(guildId) ||
                queue.textChannel;


            if (!channel) {

                console.log(
                    `❌ MUSIC CHANNEL NOT FOUND: ${guildId}`
                );

                return;
            }


            musicChannels.set(
                guildId,
                channel
            );


            await channel.send({
                embeds: [
                    getAddedSongEmbed(song)
                ]
            });


        } catch (error) {

            console.error(
                '❌ ADD SONG ERROR:',
                error
            );

        }

    }
);

// ======================================================
// PLAY SONG
// ======================================================

distube.on(
    'playSong',
    async (queue, song) => {

        try {

            const guildId = queue.id;

            console.log(
                `▶️ PLAY SONG: ${song.name}`
            );

            const channel =
                getMusicChannel(guildId) ||
                queue.textChannel;

            if (channel) {

                musicChannels.set(
                    guildId,
                    channel
                );
            }


            // إنشاء لوحة التحكم مباشرة عند بدء الأغنية
            await createMusicPanel(
                queue,
                song
            );


            console.log(
                `🎛️ MUSIC PANEL READY: ${guildId}`
            );


        } catch (error) {

            console.error(
                '❌ PLAY SONG ERROR:',
                error
            );

        }

    }
);


// ======================================================
// DISCONNECT
// ======================================================

distube.on(
    'disconnect',
    async queue => {

        const guildId =
            queue.id;

        console.log(
            `⚠️ DISCONNECTED: ${guildId}`
        );


        // إذا 247 مفعّل وحصل disconnect
        // نحاول الرجوع للروم
        if (
            mode247.get(guildId)
        ) {

            const guild =
                client.guilds.cache.get(
                    guildId
                );

            const voiceChannel =
                guild?.members?.me?.voice?.channel;

            if (voiceChannel) {

                try {

                    await distube.voices.join(
                        voiceChannel
                    );

                    console.log(
                        `🔄 24/7 RECONNECTED: ${guildId}`
                    );

                } catch (error) {

                    console.error(
                        `❌ 24/7 RECONNECT ERROR: ${guildId}`,
                        error.message
                    );
                }
            }

            return;
        }


        musicPanels.delete(
            guildId
        );
    }
);


// ======================================================
// ERROR
// ======================================================

distube.on(
    'error',
    async (error, queue) => {

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


        try {

            await channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FF0000')
                        .setAuthor({
                            name: '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂'
                        })
                        .setDescription(
                            `❌ **حدث خطأ أثناء تشغيل الأغنية**\n\n` +
                            `🎵 RED MUSIC لم يستطع تشغيل المصدر.\n` +
                            `🔄 جرّب رابطاً آخر أو أعد المحاولة.`
                        )
                        .setFooter({
                            text: 'RED MUSIC • Music System'
                        })
                ]
            });

        } catch {}

    }
);


// ======================================================
// UPDATE PANEL
// ======================================================

setInterval(
    async () => {

        for (
            const guildId
            of musicPanels.keys()
        ) {

            await updateMusicPanel(
                guildId
            );
        }

    },
    10000
);


// ======================================================
// MESSAGE COMMANDS
// ======================================================

client.on(
    'messageCreate',
    async message => {

        if (
            message.author.bot ||
            !message.guild ||
            !message.content.startsWith('5')
        ) {
            return;
        }


        const raw =
            message.content
                .slice(1)
                .trim();


        if (!raw) {
            return;
        }


        const args =
            raw.split(/\s+/);


        const cmd =
            args.shift()
                ?.toLowerCase();


        // ==================================================
        // COMMAND
        // ==================================================

        if (
            cmd === 'command'
        ) {

            return message.reply({
                embeds: [
                    getCommandListEmbed()
                ]
            });
        }


        // ==================================================
        // PING
        // ==================================================

        if (
            cmd === 'ping'
        ) {

            return message.reply({
                embeds: [
                    getPingEmbed(client)
                ]
            });
        }


        const voiceChannel =
            message.member?.voice?.channel;


        // ==================================================
        // PLAY
        // 5p / 5play
        // ==================================================

        if (
            cmd === 'p' ||
            cmd === 'play'
        ) {

            if (!voiceChannel) {

                return message.reply(
                    '❌ يجب أن تكون في روم صوتي أولاً!'
                );
            }


            const query =
                args.join(' ');


            if (!query) {

                return message.reply(
                    '❌ اكتب اسم الأغنية أو جزء من اسمها أو الرابط.'
                );
            }


            musicChannels.set(
                message.guildId,
                message.channel
            );


            try {

                await distube.play(
                    voiceChannel,
                    query,
                    {
                        textChannel:
                            message.channel,

                        member:
                            message.member
                    }
                );

            } catch (error) {

                console.error(
                    '❌ PLAY ERROR:',
                    error
                );

                message.reply(
                    `❌ لم أستطع تشغيل الأغنية.\n\`${error?.message || 'Unknown error'}\``
                ).catch(() => {});
            }


            return;
        }


        // ==================================================
        // JOIN
        // ==================================================

        if (
            cmd === 'join'
        ) {

            if (!voiceChannel) {

                return message.reply(
                    '❌ يجب أن تكون في روم صوتي!'
                );
            }


            musicChannels.set(
                message.guildId,
                message.channel
            );


            try {

                await distube.voices.join(
                    voiceChannel
                );

                await sendJoinMessage(
                    message.channel
                );

            } catch (error) {

                console.error(
                    '❌ JOIN ERROR:',
                    error
                );

                message.reply(
                    '❌ لم أستطع دخول الروم.'
                ).catch(() => {});
            }

            return;
        }


        // ==================================================
        // LEAVE
        // ==================================================

        if (
            cmd === 'leave'
        ) {

            const guildId =
                message.guildId;


            manualLeave.add(
                guildId
            );

            mode247.set(
                guildId,
                false
            );


            await leaveGuildVoice(
                message.guild
            );


            await sendLeaveMessage(
                guildId
            );


            setTimeout(
                () => {
                    manualLeave.delete(
                        guildId
                    );
                },
                3000
            );

            return;
        }


        // ==================================================
        // STOP
        // ==================================================

        if (
            cmd === 'stop'
        ) {

            if (!voiceChannel) {

                return message.reply(
                    '❌ يجب أن تكون في روم صوتي حتى تستخدم هذا الأمر.'
                );
            }


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

                if (!queue.paused) {

                    distube.pause(
                        message.guildId
                    );
                }

            } catch (error) {

                console.error(
                    '❌ STOP ERROR:',
                    error
                );
            }


            await sendStopMessage(
                message.guildId
            );


            await updateMusicPanel(
                message.guildId
            );


            return;
        }


        // ==================================================
        // SKIP
        // ==================================================

        if (
            cmd === 'skip'
        ) {

            try {

                await distube.skip(
                    message.guildId
                );

            } catch {

                message.reply(
                    '❌ لا توجد أغنية أخرى.'
                ).catch(() => {});
            }

            return;
        }


        // ==================================================
        // PAUSE
        // ==================================================

        if (
            cmd === 'pause'
        ) {

            try {

                distube.pause(
                    message.guildId
                );

            } catch {}

            return;
        }


        // ==================================================
        // RESUME
        // ==================================================

        if (
            cmd === 'resume'
        ) {

            try {

                distube.resume(
                    message.guildId
                );

            } catch {}

            return;
        }


        // ==================================================
        // 247
        // ==================================================

        if (
            cmd === '247'
        ) {

            const guildId =
                message.guildId;


            const status =
                !mode247.get(
                    guildId
                );


            mode247.set(
                guildId,
                status
            );


            // تفعيل 24/7
            if (status) {

                if (!voiceChannel) {

                    mode247.set(
                        guildId,
                        false
                    );

                    return message.reply(
                        '❌ يجب أن تكون في روم صوتي حتى تفعل 24/7.'
                    );
                }


                musicChannels.set(
                    guildId,
                    message.channel
                );


                try {

                    await distube.voices.join(
                        voiceChannel
                    );

                } catch (error) {

                    console.error(
                        '❌ 247 JOIN ERROR:',
                        error
                    );

                    mode247.set(
                        guildId,
                        false
                    );

                    return message.reply(
                        '❌ لم أستطع إبقاء البوت في الروم.'
                    );
                }


                return message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#FF0000')
                            .setDescription(
                                `🔴 **RED MUSIC 24/7**\n\n` +
                                `الحالة: **مفعّل ✅**\n\n` +
                                `🎧 البوت سيبقى في الروم الصوتي ولن يخرج عند انتهاء الأغاني.`
                            )
                    ]
                });
            }


            // إيقاف 24/7
            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FF0000')
                        .setDescription(
                            `🔴 **RED MUSIC 24/7**\n\n` +
                            `الحالة: **متوقف ❌**`
                        )
                ]
            });
        }


        // ==================================================
        // LIST
        // ==================================================

        if (
            cmd === 'list'
        ) {

            const sub =
                args.shift()
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


                if (
                    !savedPlaylists.has(
                        message.guildId
                    )
                ) {

                    savedPlaylists.set(
                        message.guildId,
                        new Map()
                    );
                }


                const lists =
                    savedPlaylists.get(
                        message.guildId
                    );


                if (
                    lists.has(
                        name.toLowerCase()
                    )
                ) {

                    return message.reply(
                        '❌ هذه القائمة موجودة مسبقاً.'
                    );
                }


                lists.set(
                    name.toLowerCase(),
                    {
                        name,
                        songs: []
                    }
                );


                return message.reply(
                    `✅ تم إنشاء قائمة **${name}**.`
                );
            }


            // ADD
            if (
                sub === 'add'
            ) {

                const listName =
                    args.shift();


                const song =
                    args.join(' ');


                if (
                    !listName ||
                    !song
                ) {

                    return message.reply(
                        '❌ الاستخدام: `5list add اسم_القائمة اسم_الأغنية`'
                    );
                }


                const lists =
                    savedPlaylists.get(
                        message.guildId
                    );


                const playlist =
                    lists?.get(
                        listName.toLowerCase()
                    );


                if (!playlist) {

                    return message.reply(
                        '❌ القائمة غير موجودة. أنشئها أولاً بـ `5list create`.'
                    );
                }


                playlist.songs.push(
                    song
                );


                return message.reply(
                    `✅ تمت إضافة **${song}** إلى قائمة **${playlist.name}**.`
                );
            }


            // SHOW
            if (
                sub === 'show'
            ) {

                const lists =
                    savedPlaylists.get(
                        message.guildId
                    );


                if (
                    !lists ||
                    !lists.size
                ) {

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
                                name:
                                    '𝐑𝐄𝐃 𝐌𝐔𝐒𝐈𝐂 • LISTS'
                            })
                            .setTitle(
                                '📋 قوائمك'
                            )
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
                        '❌ يجب أن تكون في روم صوتي أولاً!'
                    );
                }


                const listName =
                    args.join(' ');


                const lists =
                    savedPlaylists.get(
                        message.guildId
                    );


                const playlist =
                    lists?.get(
                        listName.toLowerCase()
                    );


                if (!playlist) {

                    return message.reply(
                        '❌ القائمة غير موجودة.'
                    );
                }


                if (
                    !playlist.songs.length
                ) {

                    return message.reply(
                        '❌ القائمة فارغة.'
                    );
                }


                musicChannels.set(
                    message.guildId,
                    message.channel
                );


                try {

                    for (
                        const song
                        of playlist.songs
                    ) {

                        await distube.play(
                            voiceChannel,
                            song,
                            {
                                textChannel:
                                    message.channel,

                                member:
                                    message.member
                            }
                        );
                    }


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


            return;
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

                const commandName =
                    interaction.commandName;

                const guildId =
                    interaction.guildId;

                const member =
                    interaction.member;

                const voiceChannel =
                    member?.voice?.channel;


                // ==================================================
                // /COMMAND
                // ==================================================

                if (
                    commandName === 'command'
                ) {

                    return interaction.reply({
                        embeds: [
                            getCommandListEmbed()
                        ],
                        ephemeral: true
                    });
                }


                // ==================================================
                // PING
                // ==================================================

                if (
                    commandName === 'ping'
                ) {

                    return interaction.reply({
                        embeds: [
                            getPingEmbed(client)
                        ]
                    });
                }


                // ==================================================
                // PLAY
                // ==================================================

                if (
                    commandName === 'play'
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


                    musicChannels.set(
                        guildId,
                        interaction.channel
                    );


                    await interaction.deferReply({
                        ephemeral: true
                    });


                    try {

                        await distube.play(
                            voiceChannel,
                            query,
                            {
                                textChannel:
                                    interaction.channel,

                                member
                            }
                        );


                        await interaction.editReply({
                            content:
                                '✅ تم إرسال الأغنية إلى RED MUSIC.'
                        });

                    } catch (error) {

                        console.error(
                            '❌ SLASH PLAY ERROR:',
                            error
                        );


                        await interaction.editReply({
                            content:
                                `❌ لم أستطع تشغيل الأغنية.\n\`${error?.message || 'Unknown error'}\``
                        });
                    }

                    return;
                }


                // ==================================================
                // PLAYLIST
                // ==================================================

                if (
                    commandName === 'playlist' ||
                    commandName === 'lista'
                ) {

                    const queue =
                        distube.getQueue(
                            guildId
                        );


                    if (
                        !queue ||
                        !queue.songs ||
                        !queue.songs.length
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


                // ==================================================
                // LIST
                // ==================================================

                if (
                    commandName === 'list'
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


                        if (
                            !savedPlaylists.has(
                                guildId
                            )
                        ) {

                            savedPlaylists.set(
                                guildId,
                                new Map()
                            );
                        }


                        const lists =
                            savedPlaylists.get(
                                guildId
                            );


                        if (
                            lists.has(
                                name.toLowerCase()
                            )
                        ) {

                            return interaction.reply({
                                content:
                                    '❌ هذه القائمة موجودة مسبقاً.',
                                ephemeral: true
                            });
                        }


                        lists.set(
                            name.toLowerCase(),
                            {
                                name,
                                songs: []
                            }
                        );


                        return interaction.reply({
                            content:
                                `✅ تم إنشاء قائمة **${name}**.`,
                            ephemeral: true
                        });
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


                        const lists =
                            savedPlaylists.get(
                                guildId
                            );


                        const playlist =
                            lists?.get(
                                name.toLowerCase()
                            );


                        if (!playlist) {

                            return interaction.reply({
                                content:
                                    '❌ القائمة غير موجودة.',
                                ephemeral: true
                            });
                        }


                        playlist.songs.push(
                            song
                        );


                        return interaction.reply({
                            content:
                                `✅ تمت إضافة **${song}** إلى قائمة **${playlist.name}**.`,
                            ephemeral: true
                        });
                    }


                    // SHOW
                    if (
                        sub === 'show'
                    ) {

                        const lists =
                            savedPlaylists.get(
                                guildId
                            );


                        if (
                            !lists ||
                            !lists.size
                        ) {

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
                            savedPlaylists.get(
                                guildId
                            );


                        const playlist =
                            lists?.get(
                                name.toLowerCase()
                            );


                        if (!playlist) {

                            return interaction.reply({
                                content:
                                    '❌ القائمة غير موجودة.',
                                ephemeral: true
                            });
                        }


                        if (
                            !playlist.songs.length
                        ) {

                            return interaction.reply({
                                content:
                                    '❌ القائمة فارغة.',
                                ephemeral: true
                            });
                        }


                        musicChannels.set(
                            guildId,
                            interaction.channel
                        );


                        await interaction.deferReply({
                            ephemeral: true
                        });


                        try {

                            for (
                                const song
                                of playlist.songs
                            ) {

                                await distube.play(
                                    voiceChannel,
                                    song,
                                    {
                                        textChannel:
                                            interaction.channel,

                                        member
                                    }
                                );
                            }


                            await interaction.editReply({
                                content:
                                    `▶️ تم تشغيل قائمة **${playlist.name}**.`
                            });

                        } catch (error) {

                            console.error(
                                '❌ SLASH PLAYLIST ERROR:',
                                error
                            );


                            await interaction.editReply({
                                content:
                                    '❌ حدث خطأ أثناء تشغيل القائمة.'
                            });
                        }


                        return;
                    }
                }


                // ==================================================
                // JOIN
                // ==================================================

                if (
                    commandName === 'join'
                ) {

                    if (!voiceChannel) {

                        return interaction.reply({
                            content:
                                '❌ يجب أن تكون في روم صوتي!',
                            ephemeral: true
                        });
                    }


                    musicChannels.set(
                        guildId,
                        interaction.channel
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


                // ==================================================
                // LEAVE
                // ==================================================

                if (
                    commandName === 'leave'
                ) {

                    const guild =
                        interaction.guild;


                    mode247.set(
                        guildId,
                        false
                    );

                    manualLeave.add(
                        guildId
                    );


                    await leaveGuildVoice(
                        guild
                    );


                    await sendLeaveMessage(
                        guildId
                    );


                    setTimeout(
                        () => {
                            manualLeave.delete(
                                guildId
                            );
                        },
                        3000
                    );


                    return interaction.reply({
                        content:
                            '👋 تم إخراج RED MUSIC من الروم.',
                        ephemeral: true
                    });
                }


                // ==================================================
                // STOP
                // ==================================================

                if (
                    commandName === 'stop'
                ) {

                    if (!voiceChannel) {

                        return interaction.reply({
                            content:
                                '❌ يجب أن تكون في روم صوتي حتى تستخدم الأمر.',
                            ephemeral: true
                        });
                    }


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


                    try {

                        if (!queue.paused) {

                            distube.pause(
                                guildId
                            );
                        }

                    } catch (error) {

                        console.error(
                            '❌ STOP ERROR:',
                            error
                        );
                    }


                    await sendStopMessage(
                        guildId
                    );


                    await updateMusicPanel(
                        guildId
                    );


                    return interaction.reply({
                        content:
                            '⏸️ تم إيقاف الموسيقى مؤقتاً.',
                        ephemeral: true
                    });
                }


                // ==================================================
                // SKIP
                // ==================================================

                if (
                    commandName === 'skip'
                ) {

                    try {

                        await distube.skip(
                            guildId
                        );


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


                // ==================================================
                // PAUSE
                // ==================================================

                if (
                    commandName === 'pause'
                ) {

                    try {

                        distube.pause(
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
                                '❌ لا توجد موسيقى.',
                            ephemeral: true
                        });
                    }
                }


                // ==================================================
                // RESUME
                // ==================================================

                if (
                    commandName === 'resume'
                ) {

                    try {

                        distube.resume(
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
                                '❌ لا توجد موسيقى.',
                            ephemeral: true
                        });
                    }
                }


                // ==================================================
                // SEEK
                // ==================================================

                if (
                    commandName === 'seek'
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
                                '❌ لا توجد أغنية تعمل.',
                            ephemeral: true
                        });
                    }


                    try {

                        await queue.seek(
                            seconds
                        );


                        return interaction.reply({
                            content:
                                `⏩ تم الانتقال إلى \`${formatTime(seconds)}\`.`,
                            ephemeral: true
                        });

                    } catch {

                        return interaction.reply({
                            content:
                                '❌ لا يمكن الانتقال لهذا المكان.',
                            ephemeral: true
                        });
                    }
                }


                // ==================================================
                // 247
                // ==================================================

                if (
                    commandName === '247'
                ) {

                    const status =
                        !mode247.get(
                            guildId
                        );


                    mode247.set(
                        guildId,
                        status
                    );


                    // ENABLE
                    if (status) {

                        if (!voiceChannel) {

                            mode247.set(
                                guildId,
                                false
                            );

                            return interaction.reply({
                                content:
                                    '❌ يجب أن تكون في روم صوتي حتى تفعل 24/7.',
                                ephemeral: true
                            });
                        }


                        musicChannels.set(
                            guildId,
                            interaction.channel
                        );


                        try {

                            await distube.voices.join(
                                voiceChannel
                            );

                        } catch (error) {

                            console.error(
                                '❌ 247 JOIN ERROR:',
                                error
                            );

                            mode247.set(
                                guildId,
                                false
                            );

                            return interaction.reply({
                                content:
                                    '❌ لم أستطع إبقاء البوت في الروم.',
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
                                        `🎧 سيبقى البوت في الروم الصوتي حتى لو انتهت الأغاني أو خرج جميع الأشخاص.`
                                    )
                            ],
                            ephemeral: true
                        });
                    }


                    // DISABLE
                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setDescription(
                                    `🔴 **RED MUSIC 24/7**\n\n` +
                                    `الحالة: **متوقف ❌**`
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

                const guildId =
                    interaction.guildId;

                const guild =
                    interaction.guild;

                const member =
                    interaction.member;


                if (!isInVoice(member)) {

                    return interaction.reply({
                        content:
                            '❌ يجب أن تكون داخل روم صوتي حتى تتحكم بالموسيقى.',
                        ephemeral: true
                    });
                }


                if (
                    guild?.members?.me?.voice?.channel &&
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


                const queue =
                    distube.getQueue(
                        guildId
                    );


                if (
                    !queue &&
                    interaction.customId !== 'btn_stop'
                ) {

                    return interaction.reply({
                        content:
                            '❌ لا توجد موسيقى تعمل حالياً.',
                        ephemeral: true
                    });
                }


                await interaction.deferUpdate();


                const id =
                    interaction.customId;


                // PREVIOUS
                if (
                    id === 'btn_prev'
                ) {

                    try {
                        await distube.previous(
                            guildId
                        );
                    } catch {}
                }


                // BACK 10
                else if (
                    id === 'btn_back10'
                ) {

                    if (queue) {

                        await queue.seek(
                            Math.max(
                                0,
                                (queue.currentTime || 0) - 10
                            )
                        );
                    }
                }


                // FORWARD 10
                else if (
                    id === 'btn_forward10'
                ) {

                    if (queue) {

                        const duration =
                            queue.songs[0]?.duration || 0;

                        await queue.seek(
                            Math.min(
                                duration,
                                (queue.currentTime || 0) + 10
                            )
                        );
                    }
                }


                // PAUSE
                else if (
                    id === 'btn_pause'
                ) {

                    if (
                        queue &&
                        !queue.paused
                    ) {

                        distube.pause(
                            guildId
                        );
                    }
                }


                // RESUME
                else if (
                    id === 'btn_resume'
                ) {

                    if (
                        queue &&
                        queue.paused
                    ) {

                        distube.resume(
                            guildId
                        );
                    }
                }


                // FORWARD 30
                else if (
                    id === 'btn_forward30'
                ) {

                    if (queue) {

                        const duration =
                            queue.songs[0]?.duration || 0;

                        await queue.seek(
                            Math.min(
                                duration,
                                (queue.currentTime || 0) + 30
                            )
                        );
                    }
                }


                // BACK 30
                else if (
                    id === 'btn_back30'
                ) {

                    if (queue) {

                        await queue.seek(
                            Math.max(
                                0,
                                (queue.currentTime || 0) - 30
                            )
                        );
                    }
                }


                // SKIP
                else if (
                    id === 'btn_skip'
                ) {

                    try {

                        await distube.skip(
                            guildId
                        );

                    } catch {}
                }


                // STOP
                else if (
                    id === 'btn_stop'
                ) {

                    if (queue) {

                        try {

                            if (!queue.paused) {

                                distube.pause(
                                    guildId
                                );
                            }

                        } catch {}
                    }


                    await sendStopMessage(
                        guildId
                    );


                    if (queue) {

                        await updateMusicPanel(
                            guildId
                        );
                    }


                    return;
                }


                // LOOP
                else if (
                    id === 'btn_loop'
                ) {

                    if (queue) {

                        distube.setRepeatMode(
                            queue
                        );
                    }
                }


                // SHUFFLE
                else if (
                    id === 'btn_shuffle'
                ) {

                    if (
                        queue &&
                        queue.songs.length > 1
                    ) {

                        const current =
                            queue.songs.shift();


                        for (
                            let i =
                                queue.songs.length - 1;
                            i > 0;
                            i--
                        ) {

                            const j =
                                Math.floor(
                                    Math.random() *
                                    (i + 1)
                                );


                            [
                                queue.songs[i],
                                queue.songs[j]
                            ] = [
                                queue.songs[j],
                                queue.songs[i]
                            ];
                        }


                        queue.songs.unshift(
                            current
                        );
                    }
                }


                // VOLUME DOWN
                else if (
                    id === 'btn_voldown'
                ) {

                    if (queue) {

                        distube.setVolume(
                            queue,
                            Math.max(
                                queue.volume - 10,
                                0
                            )
                        );
                    }
                }


                // VOLUME UP
                else if (
                    id === 'btn_volup'
                ) {

                    if (queue) {

                        distube.setVolume(
                            queue,
                            Math.min(
                                queue.volume + 10,
                                100
                            )
                        );
                    }
                }


                // QUEUE
                else if (
                    id === 'btn_queue'
                ) {

                    if (!queue) {
                        return;
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


                    await interaction.followUp({
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


                    return;
                }


                if (
                    id !== 'btn_queue' &&
                    id !== 'btn_stop'
                ) {

                    await updateMusicPanel(
                        guildId
                    );
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

        // فقط إذا كان التغيير متعلق بالبوت
        if (
            oldState.member?.id === client.user.id
        ) {

            // البوت خرج من الروم
            if (
                oldState.channelId &&
                !newState.channelId
            ) {

                const guild =
                    oldState.guild;

                const guildId =
                    guild.id;


                musicPanels.delete(
                    guildId
                );


                // إذا 247 مفعّل
                // نحاول إرجاعه
                if (
                    mode247.get(
                        guildId
                    ) &&
                    !manualLeave.has(
                        guildId
                    )
                ) {

                    setTimeout(
                        async () => {

                            try {

                                const currentChannel =
                                    guild.members.me?.voice?.channel;

                                if (
                                    !currentChannel
                                ) {

                                    const channel =
                                        oldState.channel;

                                    if (channel) {

                                        await distube.voices.join(
                                            channel
                                        );

                                        console.log(
                                            `🔄 24/7 REJOIN SUCCESS: ${guildId}`
                                        );
                                    }
                                }

                            } catch (error) {

                                console.error(
                                    `❌ 24/7 REJOIN ERROR: ${guildId}`,
                                    error.message
                                );
                            }

                        },
                        3000
                    );

                    return;
                }


                if (
                    manualLeave.has(
                        guildId
                    )
                ) {

                    return;
                }


                await sendLeaveMessage(
                    guildId
                );

                return;
            }


            return;
        }


        // ==================================================
        // إذا شخص دخل أو خرج من روم البوت
        // ==================================================

        const guild =
            newState.guild;

        const guildId =
            guild.id;

        const botChannel =
            guild.members.me?.voice?.channel;


        if (!botChannel) {
            return;
        }


        // إذا 24/7 مفعّل:
        // لا يخرج مهما صار
        if (
            mode247.get(
                guildId
            )
        ) {

            return;
        }


        // إذا ما عاد في أي شخص داخل الروم
        if (
            !hasHumanMembers(
                botChannel
            )
        ) {

            console.log(
                `👤 VOICE EMPTY - LEAVING: ${guildId}`
            );


            setTimeout(
                async () => {

                    const currentChannel =
                        guild.members.me?.voice?.channel;

                    if (
                        currentChannel &&
                        !hasHumanMembers(
                            currentChannel
                        ) &&
                        !mode247.get(
                            guildId
                        )
                    ) {

                        await leaveGuildVoice(
                            guild
                        );

                        await sendLeaveMessage(
                            guildId
                        );
                    }

                },
                5000
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
            '❌ Discord Client Error:',
            error
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
            '❌ Unhandled Rejection:',
            error
        );
    }
);


process.on(
    'uncaughtException',
    error => {

        console.error(
            '❌ Uncaught Exception:',
            error
        );
    }
);


// ======================================================
// LOGIN
// ======================================================

client.login(
    process.env.TOKEN
);
