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

const fs = require("fs");
const path = require("path");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN غير موجود.");
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
            saveData();
            return;
        }

        const file = fs.readFileSync(DATA_FILE, "utf8");

        if (!file.trim()) {
            return;
        }

        data = JSON.parse(file);

        if (!data.guilds) {
            data.guilds = {};
        }

    } catch (error) {
        console.error("❌ Data load error:", error);
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
        console.error("❌ Data save error:", error);
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

    plugins: [
        new SoundCloudPlugin(),

        new YtDlpPlugin({
            update: true
        })
    ]
});

console.log("🔴 RED MUSIC");
console.log("✅ DisTube loaded");

// ======================================================
// RUNTIME
// ======================================================

const leaveTimers = new Map();
const controlMessages = new Map();
const textChannels = new Map();

// ======================================================
// HELPERS
// ======================================================

function getQueue(guildId) {
    return distube.getQueue(guildId);
}

function getBotVoiceChannel(guild) {
    return guild.members.me?.voice?.channel || null;
}

function formatTime(seconds) {

    seconds = Math.max(
        0,
        Math.floor(Number(seconds) || 0)
    );

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function progressBar(current, duration) {

    const total = 20;

    if (!duration || duration <= 0) {
        return "━━━━━━━━━━━━━━━━━━━━";
    }

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

function clearLeaveTimer(guildId) {

    const timer = leaveTimers.get(guildId);

    if (timer) {
        clearTimeout(timer);
        leaveTimers.delete(guildId);
    }
}

function sameVoice(member) {

    const botChannel =
        getBotVoiceChannel(member.guild);

    if (!member.voice?.channel) {
        return false;
    }

    if (!botChannel) {
        return true;
    }

    return (
        member.voice.channel.id ===
        botChannel.id
    );
}

function voiceError(member) {

    if (!member.voice?.channel) {
        return "❌ لازم تدخل روم صوتي أولاً.";
    }

    const botChannel =
        getBotVoiceChannel(member.guild);

    if (
        botChannel &&
        botChannel.id !== member.voice.channel.id
    ) {
        return "❌ لازم تكون بنفس الروم الصوتي مع البوت.";
    }

    return null;
}

function send(channel, content) {

    if (!channel?.isTextBased()) {
        return;
    }

    return channel.send(content).catch(() => {});
}

// ======================================================
// 10 MINUTE AUTO LEAVE
// ======================================================

function scheduleLeave(guild) {

    const guildData =
        getGuildData(guild.id);

    if (guildData.mode247) {
        return;
    }

    clearLeaveTimer(guild.id);

    const timer = setTimeout(async () => {

        try {

            const currentData =
                getGuildData(guild.id);

            if (currentData.mode247) {
                return;
            }

            const queue =
                getQueue(guild.id);

            if (queue) {
                return;
            }

            const voiceChannel =
                getBotVoiceChannel(guild);

            if (!voiceChannel) {
                return;
            }

            await distube.voices.leave(
                guild.id
            );

            const channelId =
                textChannels.get(guild.id);

            if (channelId) {

                const channel =
                    await guild.channels
                        .fetch(channelId)
                        .catch(() => null);

                if (channel?.isTextBased()) {
                    await channel.send(
                        "👋 خرجت من الروم الصوتي بعد 10 دقائق بدون تشغيل."
                    ).catch(() => {});
                }
            }

        } catch (error) {
            console.error(
                "❌ Auto leave error:",
                error
            );
        }

    }, IDLE_LEAVE_TIME);

    leaveTimers.set(
        guild.id,
        timer
    );
}

// ======================================================
// CONTROL PANEL
// ======================================================

function createPanel(queue, song) {

    const current =
        queue.currentTime || 0;

    const duration =
        song.duration ||
        queue.duration ||
        0;

    const requestedBy =
        song.user
            ? `<@${song.user.id}>`
            : "Unknown";

    const embed =
        new EmbedBuilder()
            .setColor(RED)
            .setTitle("🔴 RED MUSIC")
            .setDescription(
                [
                    "🎧 **NOW PLAYING**",
                    "",
                    `🎵 **${song.name || "Unknown"}**`,
                    "",
                    `\`${progressBar(current, duration)}\``,
                    `**${formatTime(current)}** ─────── **${formatTime(duration)}**`,
                    "",
                    "👤 **REQUESTED BY**",
                    requestedBy,
                    "",
                    "🔊 **VOLUME**",
                    `\`${queue.volume}%\``,
                    "",
                    "🔁 **LOOP**",
                    `\`${queue.repeatMode === 0 ? "OFF" : queue.repeatMode === 1 ? "SONG" : "QUEUE"}\``
                ].join("\n")
            );

    if (song.thumbnail) {
        embed.setThumbnail(song.thumbnail);
    }

    if (song.url) {
        embed.setURL(song.url);
    }

    const row1 =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId("previous")
                    .setLabel("⏮️")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("back10")
                    .setLabel("⏪")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("pause")
                    .setLabel("⏸️")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("resume")
                    .setLabel("▶️")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId("forward10")
                    .setLabel("⏩")
                    .setStyle(ButtonStyle.Secondary)
            );

    const row2 =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId("skip")
                    .setLabel("⏭️")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("loop")
                    .setLabel("🔁")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("shuffle")
                    .setLabel("🔀")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("queue")
                    .setLabel("📋")
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId("stop")
                    .setLabel("⏹️")
                    .setStyle(ButtonStyle.Danger)
            );

    const row3 =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId("volumeDown")
                    .setLabel("🔉")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("volumeUp")
                    .setLabel("🔊")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("back30")
                    .setLabel("-30s")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("forward30")
                    .setLabel("+30s")
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

async function updatePanel(guildId) {

    const queue =
        getQueue(guildId);

    const message =
        controlMessages.get(guildId);

    if (!queue || !message) {
        return;
    }

    if (!queue.songs?.[0]) {
        return;
    }

    await message.edit(
        createPanel(
            queue,
            queue.songs[0]
        )
    ).catch(() => {});
}

// ======================================================
// QUEUE TEXT
// ======================================================

function queueText(queue) {

    if (!queue || !queue.songs?.length) {
        return "📭 قائمة التشغيل فارغة.";
    }

    return queue.songs
        .slice(0, 20)
        .map((song, index) => {

            if (index === 0) {
                return `▶️ **${song.name}** \`${song.formattedDuration || ""}\``;
            }

            return `${index}. **${song.name}** \`${song.formattedDuration || ""}\``;

        })
        .join("\n");
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

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
        .setDescription("عرض قائمة التشغيل"),

    new SlashCommandBuilder()
        .setName("lista")
        .setDescription("عرض قائمة التشغيل"),

    new SlashCommandBuilder()
        .setName("stop")
        .setDescription("إيقاف الأغنية بدون حذف الـQueue"),

    new SlashCommandBuilder()
        .setName("pause")
        .setDescription("إيقاف مؤقت"),

    new SlashCommandBuilder()
        .setName("resume")
        .setDescription("استئناف"),

    new SlashCommandBuilder()
        .setName("skip")
        .setDescription("تخطي"),

    new SlashCommandBuilder()
        .setName("seek")
        .setDescription("الانتقال إلى ثانية محددة")
        .addIntegerOption(option =>
            option
                .setName("seconds")
                .setDescription("الثانية")
                .setRequired(true)
                .setMinValue(0)
        ),

    new SlashCommandBuilder()
        .setName("join")
        .setDescription("دخول البوت للروم"),

    new SlashCommandBuilder()
        .setName("leave")
        .setDescription("خروج البوت"),

    new SlashCommandBuilder()
        .setName("247")
        .setDescription("تشغيل أو إيقاف 24/7"),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("سرعة البوت"),

    new SlashCommandBuilder()
        .setName("queue")
        .setDescription("عرض الـQueue"),

    new SlashCommandBuilder()
        .setName("remove")
        .setDescription("إزالة أغنية من الـQueue")
        .addIntegerOption(option =>
            option
                .setName("number")
                .setDescription("رقم الأغنية")
                .setRequired(true)
                .setMinValue(1)
        )

].map(command => command.toJSON());

// ======================================================
// REGISTER GLOBAL COMMANDS
// ======================================================

async function registerCommands() {

    const rest =
        new REST({ version: "10" })
            .setToken(TOKEN);

    try {

        await rest.put(
            Routes.applicationCommands(
                client.user.id
            ),
            {
                body: commands
            }
        );

        console.log(
            `✅ ${commands.length} Global Slash Commands registered`
        );

    } catch (error) {

        console.error(
            "❌ Slash registration error:",
            error
        );
    }
}

// ======================================================
// PLAY FUNCTION
// ======================================================

async function playMusic({
    member,
    guild,
    textChannel,
    query
}) {

    const voiceChannel =
        member.voice?.channel;

    if (!voiceChannel) {
        throw new Error(
            "لازم تدخل روم صوتي أولاً."
        );
    }

    const botChannel =
        getBotVoiceChannel(guild);

    if (
        botChannel &&
        botChannel.id !== voiceChannel.id
    ) {
        throw new Error(
            "لازم تكون بنفس الروم الصوتي مع البوت."
        );
    }

    clearLeaveTimer(
        guild.id
    );

    textChannels.set(
        guild.id,
        textChannel.id
    );

    await distube.play(
        voiceChannel,
        query,
        {
            member,
            textChannel,
            metadata: {
                requestedBy: member.id
            }
        }
    );
}

// ======================================================
// BUTTONS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            if (!interaction.isButton()) {
                return;
            }

            const member =
                interaction.member;

            const error =
                voiceError(member);

            if (error) {
                return interaction.reply({
                    content: `❌ ${error}`,
                    ephemeral: true
                });
            }

            const queue =
                getQueue(
                    interaction.guild.id
                );

            if (!queue) {
                return interaction.reply({
                    content: "❌ لا توجد أغنية.",
                    ephemeral: true
                });
            }

            await interaction.deferUpdate();

            switch (interaction.customId) {

                case "previous":
                    await queue.previous().catch(() => {});
                    break;

                case "back10":
                    await queue.seek(
                        Math.max(
                            0,
                            queue.currentTime - 10
                        )
                    ).catch(() => {});
                    break;

                case "pause":
                    await queue.pause().catch(() => {});
                    break;

                case "resume":
                    await queue.resume().catch(() => {});
                    break;

                case "forward10":
                    await queue.seek(
                        Math.min(
                            queue.duration,
                            queue.currentTime + 10
                        )
                    ).catch(() => {});
                    break;

                case "skip":
                    await queue.skip().catch(() => {});
                    break;

                case "loop":
                    queue.setRepeatMode();
                    break;

                case "shuffle":
                    await queue.shuffle().catch(() => {});
                    break;

                case "stop":
                    await queue.pause().catch(() => {});
                    break;

                case "volumeDown":
                    queue.setVolume(
                        Math.max(
                            0,
                            queue.volume - 10
                        )
                    );
                    break;

                case "volumeUp":
                    queue.setVolume(
                        Math.min(
                            100,
                            queue.volume + 10
                        )
                    );
                    break;

                case "back30":
                    await queue.seek(
                        Math.max(
                            0,
                            queue.currentTime - 30
                        )
                    ).catch(() => {});
                    break;

                case "forward30":
                    await queue.seek(
                        Math.min(
                            queue.duration,
                            queue.currentTime + 30
                        )
                    ).catch(() => {});
                    break;

                case "queue":

                    return interaction.followUp({
                        content: queueText(queue),
                        ephemeral: true
                    });
            }

            await updatePanel(
                interaction.guild.id
            );

        } catch (error) {

            console.error(
                "❌ Button error:",
                error
            );
        }
    }
);

// ======================================================
// SLASH COMMANDS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            if (!interaction.isChatInputCommand()) {
                return;
            }

            if (!interaction.guild) {
                return interaction.reply({
                    content: "❌ استخدم الأمر داخل السيرفر.",
                    ephemeral: true
                });
            }

            const command =
                interaction.commandName;

            const member =
                interaction.member;

            // ------------------------------------------
            // PING
            // ------------------------------------------

            if (command === "ping") {

                return interaction.reply(
                    `🏓 Pong! **${client.ws.ping}ms**`
                );
            }

            // ------------------------------------------
            // PLAY
            // ------------------------------------------

            if (command === "play") {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const query =
                    interaction.options
                        .getString("song");

                await interaction.deferReply();

                try {

                    await playMusic({
                        member,
                        guild: interaction.guild,
                        textChannel: interaction.channel,
                        query
                    });

                    await interaction.editReply(
                        `🔎 جاري البحث عن **${query}**...`
                    );

                } catch (error) {

                    await interaction.editReply(
                        `❌ ${error.message}`
                    );
                }

                return;
            }

            // ------------------------------------------
            // PLAYLIST / LISTA / QUEUE
            // ------------------------------------------

            if (
                command === "playlist" ||
                command === "lista" ||
                command === "queue"
            ) {

                return interaction.reply(
                    queueText(
                        getQueue(
                            interaction.guild.id
                        )
                    )
                );
            }

            // ------------------------------------------
            // PAUSE / STOP
            // ------------------------------------------

            if (
                command === "pause" ||
                command === "stop"
            ) {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const queue =
                    getQueue(
                        interaction.guild.id
                    );

                if (!queue) {
                    return interaction.reply(
                        "❌ لا توجد أغنية."
                    );
                }

                await queue.pause();

                await updatePanel(
                    interaction.guild.id
                );

                return interaction.reply(
                    command === "stop"
                        ? "⏹️ تم إيقاف الأغنية بدون حذف الـQueue."
                        : "⏸️ تم الإيقاف المؤقت."
                );
            }

            // ------------------------------------------
            // RESUME
            // ------------------------------------------

            if (command === "resume") {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const queue =
                    getQueue(
                        interaction.guild.id
                    );

                if (!queue) {
                    return interaction.reply(
                        "❌ لا توجد قائمة تشغيل."
                    );
                }

                await queue.resume();

                await updatePanel(
                    interaction.guild.id
                );

                return interaction.reply(
                    "▶️ تم الاستئناف."
                );
            }

            // ------------------------------------------
            // SKIP
            // ------------------------------------------

            if (command === "skip") {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const queue =
                    getQueue(
                        interaction.guild.id
                    );

                if (!queue) {
                    return interaction.reply(
                        "❌ لا توجد أغنية."
                    );
                }

                await queue.skip();

                return interaction.reply(
                    "⏭️ تم التخطي."
                );
            }

            // ------------------------------------------
            // SEEK
            // ------------------------------------------

            if (command === "seek") {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const queue =
                    getQueue(
                        interaction.guild.id
                    );

                if (!queue) {
                    return interaction.reply(
                        "❌ لا توجد أغنية."
                    );
                }

                const seconds =
                    interaction.options
                        .getInteger("seconds");

                if (
                    queue.duration &&
                    seconds > queue.duration
                ) {
                    return interaction.reply(
                        `❌ الأغنية مدتها ${formatTime(queue.duration)} فقط.`
                    );
                }

                await queue.seek(seconds);

                await updatePanel(
                    interaction.guild.id
                );

                return interaction.reply(
                    `⏱️ تم الانتقال إلى **${formatTime(seconds)}**`
                );
            }

            // ------------------------------------------
            // JOIN
            // ------------------------------------------

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
                    botChannel.id !==
                    member.voice.channel.id
                ) {
                    return interaction.reply(
                        "❌ البوت موجود في روم آخر."
                    );
                }

                clearLeaveTimer(
                    interaction.guild.id
                );

                textChannels.set(
                    interaction.guild.id,
                    interaction.channel.id
                );

                await distube.voices.join(
                    member.voice.channel
                );

                return interaction.reply(
                    `🔊 دخلت إلى **${member.voice.channel.name}**`
                );
            }

            // ------------------------------------------
            // LEAVE
            // ------------------------------------------

            if (command === "leave") {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const guildData =
                    getGuildData(
                        interaction.guild.id
                    );

                if (guildData.mode247) {
                    return interaction.reply(
                        "🔴 24/7 مفعّل، أمر الخروج ممنوع."
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

            // ------------------------------------------
            // 247
            // ------------------------------------------

            if (command === "247") {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const guildData =
                    getGuildData(
                        interaction.guild.id
                    );

                guildData.mode247 =
                    !guildData.mode247;

                saveData();

                if (guildData.mode247) {

                    clearLeaveTimer(
                        interaction.guild.id
                    );

                    return interaction.reply(
                        "🔴 **24/7 ON**\nالبوت سيبقى في الروم الصوتي."
                    );
                }

                return interaction.reply(
                    "⚫ **24/7 OFF**\nعند انتهاء التشغيل سيخرج بعد 10 دقائق."
                );
            }

            // ------------------------------------------
            // REMOVE
            // ------------------------------------------

            if (command === "remove") {

                const error =
                    voiceError(member);

                if (error) {
                    return interaction.reply({
                        content: `❌ ${error}`,
                        ephemeral: true
                    });
                }

                const queue =
                    getQueue(
                        interaction.guild.id
                    );

                if (!queue) {
                    return interaction.reply(
                        "❌ الـQueue فارغ."
                    );
                }

                const number =
                    interaction.options
                        .getInteger("number");

                if (
                    number <= 0 ||
                    number >= queue.songs.length
                ) {
                    return interaction.reply(
                        "❌ الرقم غير موجود."
                    );
                }

                const removed =
                    queue.songs.splice(
                        number,
                        1
                    )[0];

                return interaction.reply(
                    `🗑️ تم حذف **${removed.name}** من الـQueue.`
                );
            }

        } catch (error) {

            console.error(
                "❌ Slash error:",
                error
            );

            if (
                interaction.replied ||
                interaction.deferred
            ) {

                await interaction.followUp({
                    content: "❌ حدث خطأ غير متوقع.",
                    ephemeral: true
                }).catch(() => {});

            } else {

                await interaction.reply({
                    content: "❌ حدث خطأ غير متوقع.",
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

// ======================================================
// SHORTCUTS
// ======================================================

client.on(
    "messageCreate",
    async message => {

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

            const args = parts;

            const member =
                message.member;

            // ------------------------------------------
            // PLAY
            // ------------------------------------------

            if (
                command === "5p" ||
                command === "5play"
            ) {

                const query =
                    args.join(" ");

                if (!query) {
                    return send(
                        message.channel,
                        "❌ اكتب اسم الأغنية أو الرابط."
                    );
                }

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                try {

                    await playMusic({
                        member,
                        guild: message.guild,
                        textChannel: message.channel,
                        query
                    });

                } catch (error) {

                    await send(
                        message.channel,
                        `❌ ${error.message}`
                    );
                }

                return;
            }

            // ------------------------------------------
            // STOP / PAUSE
            // ------------------------------------------

            if (
                command === "5stop" ||
                command === "5pause"
            ) {

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                const queue =
                    getQueue(
                        message.guild.id
                    );

                if (!queue) {
                    return send(
                        message.channel,
                        "❌ لا توجد أغنية."
                    );
                }

                await queue.pause();

                await updatePanel(
                    message.guild.id
                );

                return send(
                    message.channel,
                    "⏸️ تم إيقاف الأغنية بدون حذف الـQueue."
                );
            }

            // ------------------------------------------
            // RESUME
            // ------------------------------------------

            if (command === "5resume") {

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                const queue =
                    getQueue(
                        message.guild.id
                    );

                if (!queue) {
                    return send(
                        message.channel,
                        "❌ لا توجد قائمة تشغيل."
                    );
                }

                await queue.resume();

                await updatePanel(
                    message.guild.id
                );

                return send(
                    message.channel,
                    "▶️ تم الاستئناف."
                );
            }

            // ------------------------------------------
            // SKIP
            // ------------------------------------------

            if (command === "5skip") {

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                const queue =
                    getQueue(
                        message.guild.id
                    );

                if (!queue) {
                    return send(
                        message.channel,
                        "❌ لا توجد أغنية."
                    );
                }

                await queue.skip();

                return send(
                    message.channel,
                    "⏭️ تم التخطي."
                );
            }

            // ------------------------------------------
            // SEEK
            // ------------------------------------------

            if (command === "5seek") {

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                const queue =
                    getQueue(
                        message.guild.id
                    );

                if (!queue) {
                    return send(
                        message.channel,
                        "❌ لا توجد أغنية."
                    );
                }

                const seconds =
                    Number(args[0]);

                if (
                    !Number.isFinite(seconds) ||
                    seconds < 0
                ) {
                    return send(
                        message.channel,
                        "❌ استخدم: `5seek 120`"
                    );
                }

                if (
                    queue.duration &&
                    seconds > queue.duration
                ) {
                    return send(
                        message.channel,
                        `❌ الأغنية مدتها ${formatTime(queue.duration)} فقط.`
                    );
                }

                await queue.seek(seconds);

                await updatePanel(
                    message.guild.id
                );

                return send(
                    message.channel,
                    `⏱️ تم الانتقال إلى **${formatTime(seconds)}**`
                );
            }

            // ------------------------------------------
            // JOIN
            // ------------------------------------------

            if (command === "5join") {

                if (!member.voice?.channel) {
                    return send(
                        message.channel,
                        "❌ ادخل روم صوتي أولاً."
                    );
                }

                clearLeaveTimer(
                    message.guild.id
                );

                textChannels.set(
                    message.guild.id,
                    message.channel.id
                );

                await distube.voices.join(
                    member.voice.channel
                );

                return send(
                    message.channel,
                    `🔊 دخلت إلى **${member.voice.channel.name}**`
                );
            }

            // ------------------------------------------
            // LEAVE
            // ------------------------------------------

            if (command === "5leave") {

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                const guildData =
                    getGuildData(
                        message.guild.id
                    );

                if (guildData.mode247) {
                    return send(
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

                return send(
                    message.channel,
                    "👋 خرجت من الروم الصوتي."
                );
            }

            // ------------------------------------------
            // 247
            // ------------------------------------------

            if (command === "5247") {

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                const guildData =
                    getGuildData(
                        message.guild.id
                    );

                guildData.mode247 =
                    !guildData.mode247;

                saveData();

                if (guildData.mode247) {

                    clearLeaveTimer(
                        message.guild.id
                    );

                    return send(
                        message.channel,
                        "🔴 **24/7 ON** — البوت سيبقى في الروم."
                    );
                }

                return send(
                    message.channel,
                    "⚫ **24/7 OFF** — سيخرج بعد 10 دقائق."
                );
            }

            // ------------------------------------------
            // PING
            // ------------------------------------------

            if (command === "5ping") {

                return send(
                    message.channel,
                    `🏓 Pong! **${client.ws.ping}ms**`
                );
            }

            // ------------------------------------------
            // QUEUE
            // ------------------------------------------

            if (command === "5queue") {

                return send(
                    message.channel,
                    queueText(
                        getQueue(
                            message.guild.id
                        )
                    )
                );
            }

            // ------------------------------------------
            // REMOVE
            // ------------------------------------------

            if (command === "5remove") {

                const error =
                    voiceError(member);

                if (error) {
                    return send(
                        message.channel,
                        `❌ ${error}`
                    );
                }

                const queue =
                    getQueue(
                        message.guild.id
                    );

                if (!queue) {
                    return send(
                        message.channel,
                        "❌ الـQueue فارغ."
                    );
                }

                const number =
                    Number(args[0]);

                if (
                    !Number.isInteger(number) ||
                    number <= 0 ||
                    number >= queue.songs.length
                ) {
                    return send(
                        message.channel,
                        "❌ الرقم غير صحيح. استخدم `5queue`."
                    );
                }

                const removed =
                    queue.songs.splice(
                        number,
                        1
                    )[0];

                return send(
                    message.channel,
                    `🗑️ تم حذف **${removed.name}**.`
                );
            }

            // ------------------------------------------
            // PLAYLIST SYSTEM
            // ------------------------------------------

            if (command === "5list") {

                const sub =
                    (args.shift() || "")
                        .toLowerCase();

                const guildData =
                    getGuildData(
                        message.guild.id
                    );

                // CREATE

                if (sub === "create") {

                    const name =
                        args.join(" ").trim();

                    if (!name) {
                        return send(
                            message.channel,
                            "❌ `5list create <name>`"
                        );
                    }

                    if (
                        guildData.playlists[name]
                    ) {
                        return send(
                            message.channel,
                            "❌ القائمة موجودة مسبقاً."
                        );
                    }

                    guildData.playlists[name] = [];

                    saveData();

                    return send(
                        message.channel,
                        `📋 تم إنشاء **${name}**.`
                    );
                }

                // ADD

                if (sub === "add") {

                    const name =
                        args.shift();

                    const song =
                        args.join(" ").trim();

                    if (!name || !song) {
                        return send(
                            message.channel,
                            "❌ `5list add <name> <song>`"
                        );
                    }

                    if (
                        !guildData.playlists[name]
                    ) {
                        return send(
                            message.channel,
                            "❌ القائمة غير موجودة."
                        );
                    }

                    guildData.playlists[name].push(
                        song
                    );

                    saveData();

                    return send(
                        message.channel,
                        `🎵 تمت إضافة **${song}** إلى **${name}**.`
                    );
                }

                // SHOW

                if (sub === "show") {

                    const names =
                        Object.keys(
                            guildData.playlists
                        );

                    if (!names.length) {
                        return send(
                            message.channel,
                            "📭 لا توجد قوائم."
                        );
                    }

                    return send(
                        message.channel,
                        names
                            .map(
                                name =>
                                    `📋 **${name}** — ${guildData.playlists[name].length} أغنية`
                            )
                            .join("\n")
                    );
                }

                // PLAY

                if (sub === "play") {

                    const name =
                        args.join(" ").trim();

                    const playlist =
                        guildData.playlists[name];

                    if (!playlist) {
                        return send(
                            message.channel,
                            "❌ القائمة غير موجودة."
                        );
                    }

                    if (!playlist.length) {
                        return send(
                            message.channel,
                            "❌ القائمة فارغة."
                        );
                    }

                    const error =
                        voiceError(member);

                    if (error) {
                        return send(
                            message.channel,
                            `❌ ${error}`
                        );
                    }

                    for (const song of playlist) {

                        try {

                            await playMusic({
                                member,
                                guild: message.guild,
                                textChannel: message.channel,
                                query: song
                            });

                        } catch (error) {

                            console.error(
                                "Playlist error:",
                                error.message
                            );
                        }
                    }

                    return send(
                        message.channel,
                        `📋 تم تشغيل قائمة **${name}**.`
                    );
                }

                return send(
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

            // ------------------------------------------
            // COMMANDS
            // ------------------------------------------

            if (command === "5command") {

                return send(
                    message.channel,
                    [
                        "**🎵 MUSIC**",
                        "`/play <song>`",
                        "`5p <song>`",
                        "`5play <song>`",
                        "",
                        "**📋 PLAYLIST**",
                        "`/playlist`",
                        "`/lista`",
                        "`5list create <name>`",
                        "`5list add <name> <song>`",
                        "`5list show`",
                        "`5list play <name>`",
                        "",
                        "**🎧 CONTROL**",
                        "`/stop`",
                        "`/pause`",
                        "`/resume`",
                        "`/skip`",
                        "`/seek <seconds>`",
                        "",
                        "**🔊 VOICE**",
                        "`/join`",
                        "`/leave`",
                        "",
                        "**🔴 SYSTEM**",
                        "`/247`",
                        "`/ping`",
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
    }
);

// ======================================================
// DISTUBE EVENTS
// ======================================================

distube.on(
    "initQueue",
    queue => {
        queue.setVolume(50);
    }
);

distube.on(
    "addSong",
    async (queue, song) => {

        if (!queue.textChannel) {
            return;
        }

        await queue.textChannel.send(
            `🎵 **تم إضافة الأغنية للتشغيل**\n**${song.name}**`
        ).catch(() => {});
    }
);

distube.on(
    "playSong",
    async (queue, song) => {

        clearLeaveTimer(
            queue.id
        );

        if (!queue.textChannel) {
            return;
        }

        const panel =
            await queue.textChannel.send(
                createPanel(
                    queue,
                    song
                )
            );

        controlMessages.set(
            queue.id,
            panel
        );
    }
);

distube.on(
    "finishSong",
    queue => {

        const guild =
            client.guilds.cache.get(
                queue.id
            );

        if (!guild) {
            return;
        }

        const guildData =
            getGuildData(guild.id);

        if (!guildData.mode247) {
            scheduleLeave(guild);
        }
    }
);

distube.on(
    "finish",
    queue => {

        const guild =
            client.guilds.cache.get(
                queue.id
            );

        if (!guild) {
            return;
        }

        const guildData =
            getGuildData(guild.id);

        if (!guildData.mode247) {
            scheduleLeave(guild);
        }
    }
);

distube.on(
    "disconnect",
    queue => {

        const guild =
            client.guilds.cache.get(
                queue.id
            );

        if (!guild) {
            return;
        }

        clearLeaveTimer(
            guild.id
        );

        const channelId =
            textChannels.get(
                guild.id
            );

        if (channelId) {

            guild.channels
                .fetch(channelId)
                .then(channel => {

                    if (channel?.isTextBased()) {

                        channel.send(
                            "👋 **RED MUSIC** خرج من الروم الصوتي."
                        ).catch(() => {});
                    }

                })
                .catch(() => {});
        }
    }
);

distube.on(
    "error",
    async (error, queue) => {

        console.error(
            "❌ DisTube Error:",
            error
        );

        if (queue?.textChannel) {

            await queue.textChannel.send(
                `❌ **Music Error**\n\`${String(error.message).slice(0, 1800)}\``
            ).catch(() => {});
        }
    }
);

// ======================================================
// VOICE EVENTS
// ======================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {

        if (!client.user) {
            return;
        }

        if (
            oldState.id !== client.user.id &&
            newState.id !== client.user.id
        ) {
            return;
        }

        const guild =
            newState.guild;

        const oldChannel =
            oldState.channel;

        const newChannel =
            newState.channel;

        // BOT JOIN

        if (!oldChannel && newChannel) {

            const channelId =
                textChannels.get(
                    guild.id
                );

            if (channelId) {

                const channel =
                    await guild.channels
                        .fetch(channelId)
                        .catch(() => null);

                if (channel?.isTextBased()) {

                    await channel.send(
                        `🔊 **RED MUSIC** دخل إلى **${newChannel.name}**`
                    ).catch(() => {});
                }
            }
        }

        // BOT LEAVE

        if (oldChannel && !newChannel) {

            clearLeaveTimer(
                guild.id
            );

            const channelId =
                textChannels.get(
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
        }
    }
);

// ======================================================
// READY
// ======================================================

client.once(
    "ready",
    async () => {

        console.log("");
        console.log(
            "================================"
        );
        console.log(
            "🔴 RED MUSIC ONLINE"
        );
        console.log(
            `🤖 ${client.user.tag}`
        );
        console.log(
            `🏠 Servers: ${client.guilds.cache.size}`
        );
        console.log(
            `🏓 Ping: ${client.ws.ping}ms`
        );
        console.log(
            "================================"
        );
        console.log("");

        await registerCommands();

        client.user.setPresence({
            activities: [
                {
                    name: "RED MUSIC 🎵",
                    type: 2
                }
            ],
            status: "online"
        });
    }
);

// ======================================================
// ERROR PROTECTION
// ======================================================

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "❌ Unhandled Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "❌ Uncaught Exception:",
            error
        );
    }
);

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
