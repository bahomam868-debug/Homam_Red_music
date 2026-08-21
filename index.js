const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    REST,
    Routes
} = require("discord.js");

const { DisTube } = require("distube");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const ffmpeg = require("@ffmpeg-installer/ffmpeg");

const fs = require("fs");
const path = require("path");
 

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing");
    process.exit(1);
}

const PREFIX = "5";
const DATA_FILE = path.join(__dirname, "data.json");

const RED = 0xE60000;
const IDLE_LEAVE_TIME = 10 * 60 * 1000;

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
// DATA
// ======================================================

let data = {
    guilds: {}
};

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(
                DATA_FILE,
                JSON.stringify(data, null, 2)
            );
            return;
        }

        const raw = fs.readFileSync(DATA_FILE, "utf8");

        if (raw.trim()) {
            data = JSON.parse(raw);
        }

        if (!data.guilds) {
            data.guilds = {};
        }
    } catch (error) {
        console.error("❌ Failed to load data:", error);
        data = { guilds: {} };
    }
}

function saveData() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(data, null, 2)
        );
    } catch (error) {
        console.error("❌ Failed to save data:", error);
    }
}

function getGuildData(guildId) {
    if (!data.guilds[guildId]) {
        data.guilds[guildId] = {
            mode247: false,
            playlists: {}
        };

        saveData();
    }

    if (!data.guilds[guildId].playlists) {
        data.guilds[guildId].playlists = {};
    }

    return data.guilds[guildId];
}

loadData();

// ======================================================
// DISTUBE
// ======================================================

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    savePreviousSongs: true,
    joinNewVoiceChannel: false,

    ffmpeg: {
        path: ffmpeg.path
    },

    plugins: [
        new SoundCloudPlugin(),
        new YtDlpPlugin()
    ]
});

console.log("🔴 RED MUSIC");
console.log("✅ DisTube loaded");


// ======================================================
// RUNTIME STATE
// ======================================================

const leaveTimers = new Map();
const controlMessages = new Map();
const manualVoiceTextChannels = new Map();

// ======================================================
// HELPERS
// ======================================================

function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function progressBar(current, duration) {
    if (!duration || duration <= 0) {
        return "━━━━━━━━━━━━━━━━━━━━";
    }

    const total = 20;
    const position = Math.min(
        total - 1,
        Math.floor((current / duration) * total)
    );

    return (
        "━".repeat(position) +
        "🔴" +
        "━".repeat(total - position - 1)
    );
}

function getQueue(guildId) {
    return distube.getQueue(guildId);
}

function getBotVoiceChannel(guild) {
    return guild.members.me?.voice?.channel || null;
}

function isSameVoice(member) {
    const botChannel = getBotVoiceChannel(member.guild);

    if (!botChannel) {
        return !!member.voice?.channel;
    }

    return (
        !!member.voice?.channel &&
        member.voice.channel.id === botChannel.id
    );
}

function requireSameVoice(member) {
    const botChannel = getBotVoiceChannel(member.guild);

    if (!member.voice?.channel) {
        return "❌ لازم تكون داخل روم صوتي أولاً.";
    }

    if (
        botChannel &&
        member.voice.channel.id !== botChannel.id
    ) {
        return "❌ لازم تكون بنفس الروم الصوتي مع البوت.";
    }

    return null;
}

function clearLeaveTimer(guildId) {
    const timer = leaveTimers.get(guildId);

    if (timer) {
        clearTimeout(timer);
        leaveTimers.delete(guildId);
    }
}

function scheduleLeave(guild) {
    const guildData = getGuildData(guild.id);

    if (guildData.mode247) {
        return;
    }

    clearLeaveTimer(guild.id);

    const timer = setTimeout(async () => {
        try {
            const freshGuildData = getGuildData(guild.id);

            if (freshGuildData.mode247) {
                return;
            }

            const queue = getQueue(guild.id);

            if (queue) {
                return;
            }

            const botChannel = getBotVoiceChannel(guild);

            if (!botChannel) {
                return;
            }

            await distube.voices.leave(guild.id);

            const textChannelId =
                manualVoiceTextChannels.get(guild.id);

            if (textChannelId) {
                const channel =
                    await guild.channels.fetch(textChannelId).catch(() => null);

                if (channel?.isTextBased()) {
                    await channel.send(
                        "👋 خرجت من الروم الصوتي بعد 10 دقائق بدون تشغيل."
                    ).catch(() => {});
                }
            }

            manualVoiceTextChannels.delete(guild.id);
        } catch (error) {
            console.error("❌ Auto leave error:", error);
        }
    }, IDLE_LEAVE_TIME);

    leaveTimers.set(guild.id, timer);
}

function sendSafe(channel, content) {
    if (!channel?.isTextBased()) return;

    return channel.send(content).catch(() => {});
}

// ======================================================
// CONTROL PANEL
// ======================================================

function createControlPanel(queue, song) {
    const current = queue.currentTime || 0;
    const duration = song.duration || queue.duration || 0;

    const requestedBy =
        song.user
            ? `<@${song.user.id}>`
            : "Unknown";

    const embed = new EmbedBuilder()
        .setColor(RED)
        .setAuthor({
            name: "RED MUSIC"
        })
        .setDescription(
            [
                "🎧 **NOW PLAYING**",
                "",
                `🎵 **${song.name || "Unknown"}**`,
                "",
                `\`${progressBar(current, duration)}\``,
                `**${formatTime(current)}** ───────── **${formatTime(duration)}**`,
                "",
                "👤 **REQUESTED BY**",
                requestedBy,
                "",
                "🔊 **VOLUME**",
                `\`${queue.volume}%\``,
                "",
                "🔁 **LOOP**",
                `\`${queue.repeatMode === 0 ? "OFF" : queue.repeatMode === 1 ? "SONG" : "QUEUE"}\``,
                "",
                "🔴 **RED MUSIC** · Music System"
            ].join("\n")
        );

    if (song.thumbnail) {
        embed.setThumbnail(song.thumbnail);
    }

    if (song.url) {
        embed.setURL(song.url);
    }

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("music_previous")
            .setLabel("⏮️")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_back10")
            .setLabel("⏪")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_pause")
            .setLabel("⏸️")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_resume")
            .setLabel("▶️")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("music_forward10")
            .setLabel("⏩")
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("music_skip")
            .setLabel("⏭️")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_loop")
            .setLabel("🔁")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_shuffle")
            .setLabel("🔀")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_queue")
            .setLabel("📋")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("music_stop")
            .setLabel("⏹️")
            .setStyle(ButtonStyle.Danger)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("music_volume_down")
            .setLabel("🔉")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_volume_up")
            .setLabel("🔊")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_back30")
            .setLabel("-30s")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("music_forward30")
            .setLabel("+30s")
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        components: [row1, row2, row3]
    };
}

async function refreshControlPanel(guildId) {
    const queue = getQueue(guildId);

    if (!queue || !queue.songs?.[0]) {
        return;
    }

    const message = controlMessages.get(guildId);

    if (!message) {
        return;
    }

    try {
        await message.edit(
            createControlPanel(
                queue,
                queue.songs[0]
            )
        );
    } catch (error) {
        console.error("❌ Panel update error:", error.message);
    }
}

// ======================================================
// QUEUE DISPLAY
// ======================================================

function queueText(queue) {
    if (!queue || !queue.songs.length) {
        return "📭 قائمة التشغيل فارغة.";
    }

    return queue.songs
        .slice(0, 20)
        .map((song, index) => {
            const number =
                index === 0
                    ? "▶️"
                    : `**${index}.**`;

            return `${number} ${song.name} \`${song.formattedDuration}\``;
        })
        .join("\n");
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const slashCommands = [

    new SlashCommandBuilder()
        .setName("play")
        .setDescription("تشغيل أغنية")
        .addStringOption(option =>
            option
                .setName("song")
                .setDescription("اسم الأغنية أو الرابط أو جزء من الاسم")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("playlist")
        .setDescription("عرض قائمة التشغيل الحالية"),

    new SlashCommandBuilder()
        .setName("lista")
        .setDescription("عرض قائمة التشغيل الحالية"),

    new SlashCommandBuilder()
        .setName("stop")
        .setDescription("إيقاف الصوت بدون حذف قائمة التشغيل"),

    new SlashCommandBuilder()
        .setName("pause")
        .setDescription("إيقاف مؤقت"),

    new SlashCommandBuilder()
        .setName("resume")
        .setDescription("استئناف التشغيل"),

    new SlashCommandBuilder()
        .setName("skip")
        .setDescription("تخطي الأغنية"),

    new SlashCommandBuilder()
        .setName("seek")
        .setDescription("الانتقال إلى ثانية محددة")
        .addIntegerOption(option =>
            option
                .setName("seconds")
                .setDescription("الثانية المطلوبة")
                .setRequired(true)
                .setMinValue(0)
        ),

    new SlashCommandBuilder()
        .setName("join")
        .setDescription("دخول البوت إلى الروم الصوتي"),

    new SlashCommandBuilder()
        .setName("leave")
        .setDescription("خروج البوت من الروم الصوتي"),

    new SlashCommandBuilder()
        .setName("247")
        .setDescription("تشغيل أو إيقاف نظام 24/7"),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("سرعة البوت"),

    new SlashCommandBuilder()
        .setName("remove")
        .setDescription("إزالة أغنية من قائمة التشغيل")
        .addIntegerOption(option =>
            option
                .setName("number")
                .setDescription("رقم الأغنية في قائمة التشغيل")
                .setRequired(true)
                .setMinValue(1)
        ),

    new SlashCommandBuilder()
        .setName("queue")
        .setDescription("عرض قائمة التشغيل")
].map(command => command.toJSON());

// ======================================================
// REGISTER GLOBAL SLASH COMMANDS
// ======================================================

async function registerSlashCommands() {
    try {
        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(client.user.id),
            {
                body: slashCommands
            }
        );

        console.log(
            `✅ Registered ${slashCommands.length} global slash commands`
        );
    } catch (error) {
        console.error(
            "❌ Slash registration failed:",
            error
        );
    }
}

// ======================================================
// PLAY
// ======================================================

async function playSong({
    guild,
    member,
    textChannel,
    query
}) {
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
        throw new Error(
            "❌ لازم تدخل روم صوتي أولاً."
        );
    }

    const botChannel = getBotVoiceChannel(guild);

    if (
        botChannel &&
        botChannel.id !== voiceChannel.id
    ) {
        throw new Error(
            "❌ لازم تكون بنفس الروم الصوتي مع البوت."
        );
    }

    clearLeaveTimer(guild.id);

    await distube.play(
        voiceChannel,
        query,
        {
            member,
            textChannel,
            metadata: {
                requestedById: member.id
            }
        }
    );
}

// ======================================================
// SLASH INTERACTIONS
// ======================================================

client.on("interactionCreate", async interaction => {
    try {

        // ==================================================
        // BUTTONS
        // ==================================================

        if (interaction.isButton()) {

            if (!interaction.guild) {
                return interaction.reply({
                    content: "❌ هذا الأمر غير متاح هنا.",
                    ephemeral: true
                });
            }

            const voiceError =
                requireSameVoice(interaction.member);

            if (voiceError) {
                return interaction.reply({
                    content: voiceError,
                    ephemeral: true
                });
            }

            const queue =
                getQueue(interaction.guild.id);

            if (!queue) {
                return interaction.reply({
                    content: "❌ لا توجد أغنية تعمل حالياً.",
                    ephemeral: true
                });
            }

            await interaction.deferUpdate();

            switch (interaction.customId) {

                case "music_previous":
                    await queue.previous().catch(() => {});
                    break;

                case "music_back10":
                    await queue.seek(
                        Math.max(0, queue.currentTime - 10)
                    ).catch(() => {});
                    break;

                case "music_pause":
                    await queue.pause().catch(() => {});
                    break;

                case "music_resume":
                    await queue.resume().catch(() => {});
                    break;

                case "music_forward10":
                    await queue.seek(
                        Math.min(
                            queue.duration,
                            queue.currentTime + 10
                        )
                    ).catch(() => {});
                    break;

                case "music_skip":
                    await queue.skip().catch(() => {});
                    break;

                case "music_loop":
                    queue.setRepeatMode();
                    break;

                case "music_shuffle":
                    await queue.shuffle().catch(() => {});
                    break;

                case "music_stop":
                    // مهم:
                    // لا نستعمل queue.stop()
                    // لأن DisTube يحذف الـQueue.
                    await queue.pause().catch(() => {});
                    break;

                case "music_volume_down":
                    queue.setVolume(
                        Math.max(0, queue.volume - 10)
                    );
                    break;

                case "music_volume_up":
                    queue.setVolume(
                        Math.min(100, queue.volume + 10)
                    );
                    break;

                case "music_back30":
                    await queue.seek(
                        Math.max(0, queue.currentTime - 30)
                    ).catch(() => {});
                    break;

                case "music_forward30":
                    await queue.seek(
                        Math.min(
                            queue.duration,
                            queue.currentTime + 30
                        )
                    ).catch(() => {});
                    break;

                case "music_queue":
                    await interaction.followUp({
                        content: queueText(queue),
                        ephemeral: true
                    });
                    return;
            }

            await refreshControlPanel(
                interaction.guild.id
            );

            return;
        }

        // ==================================================
        // SLASH COMMANDS
        // ==================================================

        if (!interaction.isChatInputCommand()) {
            return;
        }

        if (!interaction.guild) {
            return interaction.reply({
                content: "❌ الأوامر تعمل داخل السيرفر فقط.",
                ephemeral: true
            });
        }

        const command =
            interaction.commandName;

        const member =
            interaction.member;

        // ==================================================
        // PING
        // ==================================================

        if (command === "ping") {
            return interaction.reply(
                `🏓 Pong! **${client.ws.ping}ms**`
            );
        }

        // ==================================================
        // PLAY
        // ==================================================

        if (command === "play") {

            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const query =
                interaction.options.getString("song");

            await interaction.deferReply();

            try {
                await playSong({
                    guild: interaction.guild,
                    member,
                    textChannel: interaction.channel,
                    query
                });

                await interaction.editReply(
                    `🎵 جاري البحث عن: **${query}**`
                );
            } catch (error) {
                await interaction.editReply(
                    `❌ ${error.message}`
                );
            }

            return;
        }

        // ==================================================
        // PLAYLIST / LISTA / QUEUE
        // ==================================================

        if (
            command === "playlist" ||
            command === "lista" ||
            command === "queue"
        ) {
            const queue =
                getQueue(interaction.guild.id);

            return interaction.reply({
                content: queueText(queue),
                ephemeral: false
            });
        }

        // ==================================================
        // PAUSE / STOP
        // ==================================================

        if (
            command === "pause" ||
            command === "stop"
        ) {
            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const queue =
                getQueue(interaction.guild.id);

            if (!queue) {
                return interaction.reply(
                    "❌ لا توجد أغنية تعمل."
                );
            }

            await queue.pause();

            await refreshControlPanel(
                interaction.guild.id
            );

            return interaction.reply(
                command === "stop"
                    ? "⏹️ تم إيقاف الأغنية مؤقتاً بدون حذف قائمة التشغيل."
                    : "⏸️ تم إيقاف الأغنية مؤقتاً."
            );
        }

        // ==================================================
        // RESUME
        // ==================================================

        if (command === "resume") {

            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const queue =
                getQueue(interaction.guild.id);

            if (!queue) {
                return interaction.reply(
                    "❌ لا توجد قائمة تشغيل محفوظة حالياً."
                );
            }

            await queue.resume();

            await refreshControlPanel(
                interaction.guild.id
            );

            return interaction.reply(
                "▶️ تم استئناف الأغنية."
            );
        }

        // ==================================================
        // SKIP
        // ==================================================

        if (command === "skip") {

            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const queue =
                getQueue(interaction.guild.id);

            if (!queue) {
                return interaction.reply(
                    "❌ لا توجد أغنية."
                );
            }

            await queue.skip();

            return interaction.reply(
                "⏭️ تم تخطي الأغنية."
            );
        }

        // ==================================================
        // SEEK
        // ==================================================

        if (command === "seek") {

            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const queue =
                getQueue(interaction.guild.id);

            if (!queue) {
                return interaction.reply(
                    "❌ لا توجد أغنية."
                );
            }

            const seconds =
                interaction.options.getInteger("seconds");

            if (
                seconds > queue.duration &&
                queue.duration > 0
            ) {
                return interaction.reply(
                    `❌ الأغنية مدتها ${formatTime(queue.duration)} فقط.`
                );
            }

            await queue.seek(seconds);

            await refreshControlPanel(
                interaction.guild.id
            );

            return interaction.reply(
                `⏱️ تم الانتقال إلى **${formatTime(seconds)}**`
            );
        }

        // ==================================================
        // JOIN
        // ==================================================

        if (command === "join") {

            if (!member.voice?.channel) {
                return interaction.reply(
                    "❌ ادخل روم صوتي أولاً."
                );
            }

            const botChannel =
                getBotVoiceChannel(
                    interaction.guild
                );

            if (
                botChannel &&
                botChannel.id !== member.voice.channel.id
            ) {
                return interaction.reply(
                    "❌ البوت موجود بروم صوتي آخر."
                );
            }

            clearLeaveTimer(
                interaction.guild.id
            );

            await distube.voices.join(
                member.voice.channel
            );

            manualVoiceTextChannels.set(
                interaction.guild.id,
                interaction.channel.id
            );

            return interaction.reply(
                `🔊 دخلت إلى **${member.voice.channel.name}**`
            );
        }

        // ==================================================
        // LEAVE
        // ==================================================

        if (command === "leave") {

            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const guildData =
                getGuildData(interaction.guild.id);

            if (guildData.mode247) {
                return interaction.reply(
                    "🔴 نظام 24/7 مفعّل، لذلك أمر `/leave` ممنوع حالياً."
                );
            }

            clearLeaveTimer(
                interaction.guild.id
            );

            await distube.voices.leave(
                interaction.guild.id
            );

            return interaction.reply(
                "👋 خرجت من الروم الصوتي."
            );
        }

        // ==================================================
        // 247
        // ==================================================

        if (command === "247") {

            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const guildData =
                getGuildData(interaction.guild.id);

            guildData.mode247 =
                !guildData.mode247;

            saveData();

            if (guildData.mode247) {

                clearLeaveTimer(
                    interaction.guild.id
                );

                return interaction.reply(
                    "🔴 **24/7 ON**\nالبوت لن يخرج تلقائياً من الروم الصوتي."
                );
            }

            return interaction.reply(
                "⚫ **24/7 OFF**\nعند عدم وجود تشغيل، سيخرج البوت بعد 10 دقائق."
            );
        }

        // ==================================================
        // REMOVE
        // ==================================================

        if (command === "remove") {

            const error =
                requireSameVoice(member);

            if (error) {
                return interaction.reply({
                    content: error,
                    ephemeral: true
                });
            }

            const queue =
                getQueue(interaction.guild.id);

            if (!queue) {
                return interaction.reply(
                    "❌ قائمة التشغيل فارغة."
                );
            }

            const number =
                interaction.options.getInteger("number");

            if (
                number <= 0 ||
                number >= queue.songs.length
            ) {
                return interaction.reply(
                    "❌ الرقم غير موجود. استخدم `/playlist` لمعرفة أرقام الأغاني."
                );
            }

            const removed =
                queue.songs.splice(number, 1)[0];

            await refreshControlPanel(
                interaction.guild.id
            );

            return interaction.reply(
                `🗑️ تم حذف **${removed.name}** من قائمة التشغيل.`
            );
        }

    } catch (error) {

        console.error(
            "❌ Interaction error:",
            error
        );

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content:
                    "❌ حدث خطأ غير متوقع.",
                ephemeral: true
            }).catch(() => {});
        } else {
            await interaction.reply({
                content:
                    "❌ حدث خطأ غير متوقع.",
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ======================================================
// SHORTCUT COMMANDS
// ======================================================

client.on("messageCreate", async message => {

    try {

        if (
            message.author.bot ||
            !message.guild ||
            !message.content.startsWith(PREFIX)
        ) {
            return;
        }

        const parts =
            message.content
                .trim()
                .split(/\s+/);

        const command =
            parts.shift().toLowerCase();

        const args =
            parts;

        const member =
            message.member;

        // ==================================================
        // 5P / 5PLAY
        // ==================================================

        if (
            command === "5p" ||
            command === "5play"
        ) {

            const query =
                args.join(" ");

            if (!query) {
                return sendSafe(
                    message.channel,
                    "❌ اكتب اسم الأغنية أو الرابط."
                );
            }

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            try {
                await playSong({
                    guild: message.guild,
                    member,
                    textChannel: message.channel,
                    query
                });
            } catch (error) {
                sendSafe(
                    message.channel,
                    `❌ ${error.message}`
                );
            }

            return;
        }

        // ==================================================
        // 5STOP / 5PAUSE
        // ==================================================

        if (
            command === "5stop" ||
            command === "5pause"
        ) {

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            const queue =
                getQueue(message.guild.id);

            if (!queue) {
                return sendSafe(
                    message.channel,
                    "❌ لا توجد أغنية."
                );
            }

            await queue.pause();

            await refreshControlPanel(
                message.guild.id
            );

            return sendSafe(
                message.channel,
                "⏸️ تم إيقاف الأغنية بدون حذف الـQueue."
            );
        }

        // ==================================================
        // 5RESUME
        // ==================================================

        if (command === "5resume") {

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            const queue =
                getQueue(message.guild.id);

            if (!queue) {
                return sendSafe(
                    message.channel,
                    "❌ لا توجد قائمة تشغيل."
                );
            }

            await queue.resume();

            await refreshControlPanel(
                message.guild.id
            );

            return sendSafe(
                message.channel,
                "▶️ تم استئناف الأغنية."
            );
        }

        // ==================================================
        // 5SKIP
        // ==================================================

        if (command === "5skip") {

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            const queue =
                getQueue(message.guild.id);

            if (!queue) {
                return sendSafe(
                    message.channel,
                    "❌ لا توجد أغنية."
                );
            }

            await queue.skip();

            return sendSafe(
                message.channel,
                "⏭️ تم تخطي الأغنية."
            );
        }

        // ==================================================
        // 5SEEK
        // ==================================================

        if (command === "5seek") {

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            const queue =
                getQueue(message.guild.id);

            if (!queue) {
                return sendSafe(
                    message.channel,
                    "❌ لا توجد أغنية."
                );
            }

            const seconds =
                Number(args[0]);

            if (!Number.isFinite(seconds) || seconds < 0) {
                return sendSafe(
                    message.channel,
                    "❌ استخدم: `5seek 120`"
                );
            }

            if (
                queue.duration > 0 &&
                seconds > queue.duration
            ) {
                return sendSafe(
                    message.channel,
                    `❌ الأغنية مدتها ${formatTime(queue.duration)} فقط.`
                );
            }

            await queue.seek(seconds);

            await refreshControlPanel(
                message.guild.id
            );

            return sendSafe(
                message.channel,
                `⏱️ تم الانتقال إلى **${formatTime(seconds)}**`
            );
        }

        // ==================================================
        // 5JOIN
        // ==================================================

        if (command === "5join") {

            if (!member.voice?.channel) {
                return sendSafe(
                    message.channel,
                    "❌ ادخل روم صوتي أولاً."
                );
            }

            clearLeaveTimer(
                message.guild.id
            );

            await distube.voices.join(
                member.voice.channel
            );

            manualVoiceTextChannels.set(
                message.guild.id,
                message.channel.id
            );

            return sendSafe(
                message.channel,
                `🔊 دخلت إلى **${member.voice.channel.name}**`
            );
        }

        // ==================================================
        // 5LEAVE
        // ==================================================

        if (command === "5leave") {

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            const guildData =
                getGuildData(message.guild.id);

            if (guildData.mode247) {
                return sendSafe(
                    message.channel,
                    "🔴 24/7 مفعّل، أمر الخروج ممنوع."
                );
            }

            clearLeaveTimer(
                message.guild.id
            );

            await distube.voices.leave(
                message.guild.id
            );

            return sendSafe(
                message.channel,
                "👋 خرجت من الروم الصوتي."
            );
        }

        // ==================================================
        // 5247
        // ==================================================

        if (command === "5247") {

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            const guildData =
                getGuildData(message.guild.id);

            guildData.mode247 =
                !guildData.mode247;

            saveData();

            if (guildData.mode247) {
                clearLeaveTimer(
                    message.guild.id
                );

                return sendSafe(
                    message.channel,
                    "🔴 **24/7 ON** — البوت لن يخرج تلقائياً."
                );
            }

            return sendSafe(
                message.channel,
                "⚫ **24/7 OFF** — سيخرج بعد 10 دقائق عند انتهاء التشغيل."
            );
        }

        // ==================================================
        // 5PING
        // ==================================================

        if (command === "5ping") {
            return sendSafe(
                message.channel,
                `🏓 Pong! **${client.ws.ping}ms**`
            );
        }

        // ==================================================
        // 5QUEUE
        // ==================================================

        if (command === "5queue") {
            const queue =
                getQueue(message.guild.id);

            return sendSafe(
                message.channel,
                queueText(queue)
            );
        }

        // ==================================================
        // 5REMOVE
        // ==================================================

        if (command === "5remove") {

            const error =
                requireSameVoice(member);

            if (error) {
                return sendSafe(
                    message.channel,
                    error
                );
            }

            const queue =
                getQueue(message.guild.id);

            if (!queue) {
                return sendSafe(
                    message.channel,
                    "❌ قائمة التشغيل فارغة."
                );
            }

            const number =
                Number(args[0]);

            if (
                !Number.isInteger(number) ||
                number <= 0 ||
                number >= queue.songs.length
            ) {
                return sendSafe(
                    message.channel,
                    "❌ الرقم غير صحيح. استخدم `5queue` لمعرفة الأرقام."
                );
            }

            const removed =
                queue.songs.splice(number, 1)[0];

            await refreshControlPanel(
                message.guild.id
            );

            return sendSafe(
                message.channel,
                `🗑️ تم حذف **${removed.name}** من قائمة التشغيل.`
            );
        }

        // ==================================================
        // 5LIST
        // ==================================================

        if (command === "5list") {

            const sub =
                (args.shift() || "").toLowerCase();

            const guildData =
                getGuildData(message.guild.id);

            // ----------------------------------------------
            // 5LIST CREATE
            // ----------------------------------------------

            if (sub === "create") {

                const name =
                    args.join(" ").trim();

                if (!name) {
                    return sendSafe(
                        message.channel,
                        "❌ استخدم: `5list create <name>`"
                    );
                }

                if (
                    guildData.playlists[name]
                ) {
                    return sendSafe(
                        message.channel,
                        "❌ هذه القائمة موجودة مسبقاً."
                    );
                }

                guildData.playlists[name] = [];

                saveData();

                return sendSafe(
                    message.channel,
                    `📋 تم إنشاء قائمة **${name}**.`
                );
            }

            // ----------------------------------------------
            // 5LIST ADD
            // ----------------------------------------------

            if (sub === "add") {

                const name =
                    args.shift();

                const song =
                    args.join(" ").trim();

                if (!name || !song) {
                    return sendSafe(
                        message.channel,
                        "❌ استخدم: `5list add <name> <song>`"
                    );
                }

                if (
                    !guildData.playlists[name]
                ) {
                    return sendSafe(
                        message.channel,
                        "❌ القائمة غير موجودة."
                    );
                }

                guildData.playlists[name].push(song);

                saveData();

                return sendSafe(
                    message.channel,
                    `🎵 تمت إضافة **${song}** إلى قائمة **${name}**.`
                );
            }

            // ----------------------------------------------
            // 5LIST SHOW
            // ----------------------------------------------

            if (sub === "show") {

                const names =
                    Object.keys(
                        guildData.playlists
                    );

                if (!names.length) {
                    return sendSafe(
                        message.channel,
                        "📭 لا توجد قوائم محفوظة."
                    );
                }

                const text =
                    names
                        .map(name =>
                            `📋 **${name}** — ${guildData.playlists[name].length} أغنية`
                        )
                        .join("\n");

                return sendSafe(
                    message.channel,
                    `**📋 PLAYLISTS**\n\n${text}`
                );
            }

            // ----------------------------------------------
            // 5LIST PLAY
            // ----------------------------------------------

            if (sub === "play") {

                const name =
                    args.join(" ").trim();

                if (!name) {
                    return sendSafe(
                        message.channel,
                        "❌ استخدم: `5list play <name>`"
                    );
                }

                const playlist =
                    guildData.playlists[name];

                if (!playlist) {
                    return sendSafe(
                        message.channel,
                        "❌ القائمة غير موجودة."
                    );
                }

                if (!playlist.length) {
                    return sendSafe(
                        message.channel,
                        "❌ القائمة فارغة."
                    );
                }

                const error =
                    requireSameVoice(member);

                if (error) {
                    return sendSafe(
                        message.channel,
                        error
                    );
                }

                clearLeaveTimer(
                    message.guild.id
                );

                let added = 0;

                for (const song of playlist) {
                    try {
                        await playSong({
                            guild: message.guild,
                            member,
                            textChannel: message.channel,
                            query: song
                        });

                        added++;
                    } catch (error) {
                        console.error(
                            `Playlist error: ${song}`,
                            error.message
                        );
                    }
                }

                return sendSafe(
                    message.channel,
                    `📋 تم تشغيل قائمة **${name}** وإضافة **${added}** أغنية.`
                );
            }

            return sendSafe(
                message.channel,
                [
                    "**📋 PLAYLIST**",
                    "`5list create <name>`",
                    "`5list add <name> <song>`",
                    "`5list show`",
                    "`5list play <name>`"
                ].join("\n")
            );
        }

        // ==================================================
        // 5COMMAND
        // ==================================================

        if (command === "5command") {

            return sendSafe(
                message.channel,
                [
                    "**🎵 MUSIC**",
                    "`/play <song>` • `5p <song>` • `5play <song>`",
                    "",
                    "**📋 PLAYLIST**",
                    "`/playlist` • `/lista`",
                    "`5list create <name>`",
                    "`5list add <name> <song>`",
                    "`5list show`",
                    "`5list play <name>`",
                    "",
                    "**🎧 CONTROL**",
                    "`/stop` • `/pause` • `/resume`",
                    "`/skip` • `/seek <seconds>`",
                    "",
                    "**🔊 VOICE**",
                    "`/join` • `/leave`",
                    "",
                    "**🔴 SYSTEM**",
                    "`/247` • `/ping`",
                    "",
                    "**⚡ SHORTCUTS**",
                    "`5p` • `5play` • `5stop` • `5skip`",
                    "`5pause` • `5resume` • `5join` • `5leave`",
                    "`5247` • `5ping` • `5command` • `5list`",
                    "`5queue` • `5remove <number>`"
                ].join("\n")
            );
        }

    } catch (error) {
        console.error(
            "❌ Shortcut error:",
            error
        );
    }
});

// ======================================================
// DISTUBE EVENTS
// ======================================================

distube
    .on("initQueue", queue => {
        queue.setVolume(50);
    })

    .on("addSong", async (queue, song) => {

        if (!queue.textChannel) {
            return;
        }

        await queue.textChannel.send(
            `🎵 **تم إضافة الأغنية للتشغيل**\n**${song.name}**\n👤 ${song.user || "Unknown"}`
        ).catch(() => {});
    })

    .on("addList", async (queue, playlist) => {

        if (!queue.textChannel) {
            return;
        }

        await queue.textChannel.send(
            `📋 **تم إضافة قائمة التشغيل**\n**${playlist.name}**`
        ).catch(() => {});
    })

    .on("playSong", async (queue, song) => {

        clearLeaveTimer(queue.id);

        if (!queue.textChannel) {
            return;
        }

        try {

            const panel =
                await queue.textChannel.send(
                    createControlPanel(
                        queue,
                        song
                    )
                );

            controlMessages.set(
                queue.id,
                panel
            );

        } catch (error) {
            console.error(
                "❌ Control panel error:",
                error
            );
        }
    })

    .on("finishSong", async (queue, song) => {

        const guild =
            client.guilds.cache.get(queue.id);

        if (!guild) {
            return;
        }

        const guildData =
            getGuildData(guild.id);

        // إذا في أغنية بعدها DisTube سيبدأها
        // وإذا ما في، ننتظر 10 دقائق.
        if (!guildData.mode247) {
            scheduleLeave(guild);
        }
    })

    .on("finish", async queue => {

        const guild =
            client.guilds.cache.get(queue.id);

        if (!guild) {
            return;
        }

        const guildData =
            getGuildData(guild.id);

        if (guildData.mode247) {
            return;
        }

        scheduleLeave(guild);
    })

    .on("disconnect", queue => {

        const guild =
            client.guilds.cache.get(queue.id);

        if (!guild) {
            return;
        }

        clearLeaveTimer(guild.id);

        const channelId =
            manualVoiceTextChannels.get(
                guild.id
            );

        if (channelId) {

            guild.channels.fetch(channelId)
                .then(channel => {

                    if (channel?.isTextBased()) {
                        channel.send(
                            "👋 **RED MUSIC** خرج من الروم الصوتي."
                        ).catch(() => {});
                    }

                })
                .catch(() => {});
        }

        manualVoiceTextChannels.delete(
            guild.id
        );
    })

    .on("error", async (error, queue) => {

        console.error(
            "❌ DisTube error:",
            error
        );

        if (queue?.textChannel) {

            await queue.textChannel.send(
                `❌ **Music Error**\n\`${String(error.message).slice(0, 1800)}\``
            ).catch(() => {});
        }
    })

    .on("noRelated", queue => {

        if (queue?.textChannel) {
            queue.textChannel.send(
                "📭 انتهت قائمة التشغيل ولا توجد أغنية أخرى."
            ).catch(() => {});
        }
    });

// ======================================================
// VOICE STATE
// ======================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {

        if (!client.user) {
            return;
        }

        if (
            newState.id !== client.user.id &&
            oldState.id !== client.user.id
        ) {
            return;
        }

        const guild =
            newState.guild;

        const oldChannel =
            oldState.channel;

        const newChannel =
            newState.channel;

        // ----------------------------------------------
        // BOT JOINED
        // ----------------------------------------------

        if (!oldChannel && newChannel) {

            const channelId =
                manualVoiceTextChannels.get(
                    guild.id
                );

            if (channelId) {

                const channel =
                    await guild.channels
                        .fetch(channelId)
                        .catch(() => null);

                if (channel?.isTextBased()) {

                    await channel.send(
                        `🔊 **RED MUSIC** دخل إلى الروم الصوتي **${newChannel.name}**`
                    ).catch(() => {});
                }
            }

            return;
        }

        // ----------------------------------------------
        // BOT LEFT
        // ----------------------------------------------

        if (oldChannel && !newChannel) {

            clearLeaveTimer(
                guild.id
            );

            const channelId =
                manualVoiceTextChannels.get(
                    guild.id
                );

            if (channelId) {

                const channel =
                    await guild.channels
                        .fetch(channelId)
                        .catch(() => null);

                if (channel?.isTextBased()) {

                    await channel.send(
                        "👋 **RED MUSIC** خرج من الروم الصوتي."
                    ).catch(() => {});
                }
            }

            manualVoiceTextChannels.delete(
                guild.id
            );
        }
    }
);

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {

    console.log("");
    console.log("====================================");
    console.log("🔴 RED MUSIC ONLINE");
    console.log(`🤖 ${client.user.tag}`);
    console.log(`🏠 Servers: ${client.guilds.cache.size}`);
    console.log(`🏓 Ping: ${client.ws.ping}ms`);
    console.log("====================================");
    console.log("");

    try {
        // تنظيف الأوامر القديمة لمنع التكرار قبل تسجيل الجديدة
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log("🧹 تم تنظيف الأوامر القديمة بنجاح");
    } catch (error) {
        console.error("❌ خطأ أثناء تنظيف الأوامر القديمة:", error);
    }

    await registerSlashCommands();

    client.user.setPresence({
        activities: [
            {
                name: "RED MUSIC 🎵",
                type: 2
            }
        ],
        status: "online"
    });
});

// ======================================================
// PROCESS SAFETY
// ======================================================

process.on("unhandledRejection", error => {
    console.error(
        "❌ Unhandled Rejection:",
        error
    );
});

process.on("uncaughtException", error => {
    console.error(
        "❌ Uncaught Exception:",
        error
    );
});

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);

