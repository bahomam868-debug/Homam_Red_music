// ======================================================
// SERVER & DEPENDENCIES
// ======================================================
const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('RED MUSIC is running!\n');
}).listen(process.env.PORT || 10000);

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
// DATA (JSON DATABASE)
// ======================================================

let data = { guilds: {} };

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            saveData();
            return;
        }
        const file = fs.readFileSync(DATA_FILE, "utf8");
        if (!file.trim()) return;
        data = JSON.parse(file);
        if (!data.guilds) data.guilds = {};
    } catch (error) {
        data = { guilds: {} };
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {}
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
// DISTUBE SETUP
// ======================================================

const distube = new DisTube(client, {
    emitNewSongOnly: false,
    savePreviousSongs: true,
    joinNewVoiceChannel: false,
    plugins: [
        new SoundCloudPlugin(),
        new YtDlpPlugin({
            update: false,
            args: [
                "--extractor-args", "youtube:player_client=default,android,tv",
                "--no-check-certificates",
                "--geo-bypass"
            ]
        })
    ]
});

// ======================================================
// RUNTIME MAPS
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
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function progressBar(current, duration) {
    const total = 20;
    if (!duration || duration <= 0) return "━━━━━━━━━━━━━━━━━━━━";
    const position = Math.min(total - 1, Math.floor((current / duration) * total));
    return "━".repeat(position) + "🔴" + "━".repeat(total - position - 1);
}

function clearLeaveTimer(guildId) {
    const timer = leaveTimers.get(guildId);
    if (timer) {
        clearTimeout(timer);
        leaveTimers.delete(guildId);
    }
}

function voiceError(member) {
    if (!member.voice?.channel) return "❌ لازم تدخل روم صوتي أولاً.";
    const botChannel = getBotVoiceChannel(member.guild);
    if (botChannel && botChannel.id !== member.voice.channel.id) {
        return "❌ لازم تكون بنفس الروم الصوتي مع البوت.";
    }
    return null;
}

function send(channel, content) {
    if (!channel?.isTextBased()) return;
    return channel.send(content).catch(() => {});
}

// ======================================================
// AUTO LEAVE
// ======================================================

function scheduleLeave(guild) {
    const guildData = getGuildData(guild.id);
    if (guildData.mode247) return;

    clearLeaveTimer(guild.id);

    const timer = setTimeout(async () => {
        try {
            const currentData = getGuildData(guild.id);
            if (currentData.mode247) return;
            const queue = getQueue(guild.id);
            if (queue) return;
            const voiceChannel = getBotVoiceChannel(guild);
            if (!voiceChannel) return;

            await distube.voices.leave(guild.id);
            const channelId = textChannels.get(guild.id);
            if (channelId) {
                const channel = await guild.channels.fetch(channelId).catch(() => null);
                if (channel?.isTextBased()) {
                    await channel.send("👋 خرجت من الروم الصوتي بعد 10 دقائق بدون تشغيل.").catch(() => {});
                }
            }
        } catch (error) {}
    }, IDLE_LEAVE_TIME);

    leaveTimers.set(guild.id, timer);
}

// ======================================================
// CONTROL PANEL EMBED
// ======================================================

function createPanel(queue, song) {
    const current = queue.currentTime || 0;
    const duration = song.duration || queue.duration || 0;
    const requestedBy = song.user ? `<@${song.user.id}>` : "Unknown";

    const embed = new EmbedBuilder()
        .setColor(RED)
        .setTitle("🔴 RED MUSIC CONTROL PANEL")
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

    if (song.thumbnail) embed.setThumbnail(song.thumbnail);
    if (song.url) embed.setURL(song.url);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("previous").setLabel("⏮️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("back10").setLabel("⏪").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("pause").setLabel("⏸️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("resume").setLabel("▶️").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("forward10").setLabel("⏩").setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("skip").setLabel("⏭️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("loop").setLabel("🔁").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("shuffle").setLabel("🔀").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("queue").setLabel("📋").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("stop").setLabel("⏹️").setStyle(ButtonStyle.Danger)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("volumeDown").setLabel("🔉").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("volumeUp").setLabel("🔊").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("back30").setLabel("-30s").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("forward30").setLabel("+30s").setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2, row3] };
}

async function updatePanel(guildId) {
    const queue = getQueue(guildId);
    const message = controlMessages.get(guildId);
    if (!queue || !message || !queue.songs?.[0]) return;
    await message.edit(createPanel(queue, queue.songs[0])).catch(() => {});
}

// ======================================================
// QUEUE FORMATTER
// ======================================================

function queueText(queue) {
    if (!queue || !queue.songs?.length) return "📭 قائمة التشغيل فارغة.";
    return queue.songs
        .slice(0, 20)
        .map((song, index) => {
            if (index === 0) return `▶️ **${song.name}** \`${song.formattedDuration || ""}\``;
            return `${index}. **${song.name}** \`${song.formattedDuration || ""}\``;
        })
        .join("\n");
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [
    new SlashCommandBuilder().setName("play").setDescription("تشغيل أغنية").addStringOption(o => o.setName("song").setDescription("اسم الأغنية أو الرابط").setRequired(true)),
    new SlashCommandBuilder().setName("playlist").setDescription("عرض قائمة التشغيل"),
    new SlashCommandBuilder().setName("stop").setDescription("إيقاف مؤقت"),
    new SlashCommandBuilder().setName("pause").setDescription("إيقاف مؤقت"),
    new SlashCommandBuilder().setName("resume").setDescription("استئناف"),
    new SlashCommandBuilder().setName("skip").setDescription("تخطي"),
    new SlashCommandBuilder().setName("join").setDescription("دخول البوت للروم"),
    new SlashCommandBuilder().setName("leave").setDescription("خروج البوت"),
    new SlashCommandBuilder().setName("ping").setDescription("سرعة البوت"),
    new SlashCommandBuilder().setName("queue").setDescription("عرض قائمة الانتظار")
].map(c => c.toJSON());

async function registerCommands(clientInstance) {
    if (!clientInstance.user) return;
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(clientInstance.user.id), { body: commands });
    } catch (error) {}
}

// ======================================================
// PLAY MUSIC CORE FUNCTION
// ======================================================

async function playMusic({ member, guild, textChannel, query }) {
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) throw new Error("لازم تدخل روم صوتي أولاً.");

    const botChannel = getBotVoiceChannel(guild);
    if (botChannel && botChannel.id !== voiceChannel.id) {
        throw new Error("لازم تكون بنفس الروم الصوتي مع البوت.");
    }

    clearLeaveTimer(guild.id);
    textChannels.set(guild.id, textChannel.id);

    await send(textChannel, `🔎 جاري البحث عن: **${query}**...`);

    await distube.play(voiceChannel, query, {
        member,
        textChannel,
        metadata: { requestedBy: member.id }
    });
}

// ======================================================
// BUTTONS HANDLER
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isButton()) return;

        const error = voiceError(interaction.member);
        if (error) return interaction.reply({ content: `❌ ${error}`, ephemeral: true });

        const queue = getQueue(interaction.guild.id);
        if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية.", ephemeral: true });

        await interaction.deferUpdate();

        switch (interaction.customId) {
            case "previous": await queue.previous().catch(() => {}); break;
            case "back10": await queue.seek(Math.max(0, queue.currentTime - 10)).catch(() => {}); break;
            case "pause": await queue.pause().catch(() => {}); break;
            case "resume": await queue.resume().catch(() => {}); break;
            case "forward10": await queue.seek(Math.min(queue.duration || 0, queue.currentTime + 10)).catch(() => {}); break;
            case "skip": await queue.skip().catch(() => {}); break;
            case "loop":
                if (queue.repeatMode === 0) queue.setRepeatMode(1);
                else if (queue.repeatMode === 1) queue.setRepeatMode(2);
                else queue.setRepeatMode(0);
                break;
            case "shuffle": await queue.shuffle().catch(() => {}); break;
            case "stop": await queue.stop().catch(() => {}); break;
            case "volumeDown": queue.setVolume(Math.max(0, queue.volume - 10)); break;
            case "volumeUp": queue.setVolume(Math.min(100, queue.volume + 10)); break;
            case "back30": await queue.seek(Math.max(0, queue.currentTime - 30)).catch(() => {}); break;
            case "forward30": await queue.seek(Math.min(queue.duration || 0, queue.currentTime + 30)).catch(() => {}); break;
            case "queue": return interaction.followUp({ content: queueText(queue), ephemeral: true });
        }

        await updatePanel(interaction.guild.id);
    } catch (e) {}
});

// ======================================================
// SLASH COMMANDS HANDLER
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isChatInputCommand() || !interaction.guild) return;

        const command = interaction.commandName;
        const member = interaction.member;

        if (command === "ping") return interaction.reply(`🏓 Pong! **${client.ws.ping}ms**`);

        if (command === "play") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: `❌ ${err}`, ephemeral: true });

            const query = interaction.options.getString("song");
            await interaction.deferReply();

            try {
                await playMusic({ member, guild: interaction.guild, textChannel: interaction.channel, query });
                await interaction.editReply(`✅ تمت اضافة الأغنية بنجاح.`);
            } catch (err) {
                await interaction.editReply(`❌ تعذر تشغيل الرابط أو الأغنية.`);
            }
            return;
        }

        if (command === "playlist" || command === "queue") {
            return interaction.reply(queueText(getQueue(interaction.guild.id)));
        }

        if (command === "pause" || command === "stop") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: `❌ ${err}`, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية.", ephemeral: true });
            await queue.pause();
            await updatePanel(interaction.guild.id);
            return interaction.reply("⏸️ تم الإيقاف المؤقت.");
        }

        if (command === "resume") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: `❌ ${err}`, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية.", ephemeral: true });
            await queue.resume();
            await updatePanel(interaction.guild.id);
            return interaction.reply("▶️ تم الاستئناف.");
        }

        if (command === "skip") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: `❌ ${err}`, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية.", ephemeral: true });
            await queue.skip();
            return interaction.reply("⏭️ تم التخطي.");
        }

        if (command === "join") {
            if (!member.voice?.channel) return interaction.reply("❌ ادخل روم صوتي أولاً.");
            clearLeaveTimer(interaction.guild.id);
            textChannels.set(interaction.guild.id, interaction.channel.id);
            await distube.voices.join(member.voice.channel);
            return interaction.reply(`🔊 دخلت إلى **${member.voice.channel.name}**`);
        }

        if (command === "leave") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: `❌ ${err}`, ephemeral: true });
            const guildData = getGuildData(interaction.guild.id);
            if (guildData.mode247) return interaction.reply("🔴 24/7 مفعّل، أمر الخروج ممنوع.");
            clearLeaveTimer(interaction.guild.id);
            await distube.voices.leave(interaction.guild.id);
            return interaction.reply("👋 خرجت من الروم الصوتي.");
        }

    } catch (e) {}
});

// ======================================================
// PREFIX COMMANDS (5p, 5list, etc.)
// ======================================================

client.on("messageCreate", async message => {
    try {
        if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

        const parts = message.content.trim().split(/\s+/);
        const command = parts.shift().toLowerCase();
        const args = parts;
        const member = message.member;

        if (command === "5p" || command === "5play") {
            const query = args.join(" ");
            if (!query) return send(message.channel, "❌ اكتب اسم الأغنية أو الرابط.");

            const err = voiceError(member);
            if (err) return send(message.channel, `❌ ${err}`);

            try {
                await playMusic({ member, guild: message.guild, textChannel: message.channel, query });
                await send(message.channel, `🎵 تم اضافة الأغنية للتشغيل.`);
            } catch (err) {
                await send(message.channel, `❌ لم أتمكن من تشغيل هذا الرابط أو الأغنية.`);
            }
            return;
        }

        if (command === "5stop" || command === "5pause") {
            const err = voiceError(member);
            if (err) return send(message.channel, `❌ ${err}`);
            const queue = getQueue(message.guild.id);
            if (!queue) return send(message.channel, "❌ لا توجد أغنية.");
            await queue.pause();
            await updatePanel(message.guild.id);
            return send(message.channel, "⏸️ تم الإيقاف المؤقت.");
        }

        if (command === "5resume") {
            const err = voiceError(member);
            if (err) return send(message.channel, `❌ ${err}`);
            const queue = getQueue(message.guild.id);
            if (!queue) return send(message.channel, "❌ لا توجد أغنية.");
            await queue.resume();
            await updatePanel(message.guild.id);
            return send(message.channel, "▶️ تم الاستئناف.");
        }

        if (command === "5skip") {
            const err = voiceError(member);
            if (err) return send(message.channel, `❌ ${err}`);
            const queue = getQueue(message.guild.id);
            if (!queue) return send(message.channel, "❌ لا توجد أغنية.");
            await queue.skip();
            return send(message.channel, "⏭️ تم التخطي.");
        }

        if (command === "5join") {
            if (!member.voice?.channel) return send(message.channel, "❌ ادخل روم صوتي أولاً.");
            clearLeaveTimer(message.guild.id);
            textChannels.set(message.guild.id, message.channel.id);
            await distube.voices.join(member.voice.channel);
            return send(message.channel, `🔊 دخلت إلى **${member.voice.channel.name}**`);
        }

        if (command === "5leave") {
            const err = voiceError(member);
            if (err) return send(message.channel, `❌ ${err}`);
            const guildData = getGuildData(message.guild.id);
            if (guildData.mode247) return send(message.channel, "🔴 24/7 مفعّل، أمر الخروج ممنوع.");
            clearLeaveTimer(message.guild.id);
            await distube.voices.leave(message.guild.id);
            return send(message.channel, "👋 خرجت من الروم الصوتي.");
        }

        if (command === "5ping") {
            return send(message.channel, `🏓 Pong! **${client.ws.ping}ms**`);
        }

        if (command === "5queue") {
            return send(message.channel, queueText(getQueue(message.guild.id)));
        }

        if (command === "5list") {
            const sub = (args.shift() || "").toLowerCase();
            const guildData = getGuildData(message.guild.id);

            if (sub === "create") {
                const name = args.join(" ").trim();
                if (!name) return send(message.channel, "❌ استخدم: `5list create <اسم القائمة>`");
                if (guildData.playlists[name]) return send(message.channel, "❌ القائمة موجودة مسبقاً.");
                guildData.playlists[name] = [];
                saveData();
                return send(message.channel, `📋 تم إنشاء قائمة **${name}**.`);
            }

            if (sub === "add") {
                const name = args.shift();
                const song = args.join(" ").trim();
                if (!name || !song) return send(message.channel, "❌ استخدم: `5list add <القائمة> <الرابط/الاسم>`");
                if (!guildData.playlists[name]) return send(message.channel, "❌ القائمة غير موجودة.");
                guildData.playlists[name].push(song);
                saveData();
                return send(message.channel, `🎵 تمت الإضافة إلى **${name}**.`);
            }

            if (sub === "show") {
                const names = Object.keys(guildData.playlists);
                if (!names.length) return send(message.channel, "📭 لا توجد قوائم تشغيل.");
                return send(message.channel, names.map(n => `📋 **${n}** (${guildData.playlists[n].length} أغاني)`).join("\n"));
            }

            if (sub === "play") {
                const name = args.join(" ").trim();
                const playlist = guildData.playlists[name];
                if (!playlist || !playlist.length) return send(message.channel, "❌ القائمة فارغة أو غير موجودة.");

                const err = voiceError(member);
                if (err) return send(message.channel, `❌ ${err}`);

                for (const song of playlist) {
                    try {
                        await playMusic({ member, guild: message.guild, textChannel: message.channel, query: song });
                    } catch (e) {}
                }
                return send(message.channel, `📋 جاري تشغيل قائمة **${name}**.`);
            }

            return send(message.channel, [
                "**📋 أوامر قوائم التشغيل:**",
                "`5list create <name>`",
                "`5list add <name> <song>`",
                "`5list show`",
                "`5list play <name>`"
            ].join("\n"));
        }

    } catch (e) {}
});

// ======================================================
// DISTUBE EVENTS
// ======================================================

distube.on("initQueue", queue => { queue.setVolume(50); });

distube.on("playSong", async (queue, song) => {
    clearLeaveTimer(queue.id);
    if (!queue.textChannel) return;

    try {
        const oldMessage = controlMessages.get(queue.id);
        if (oldMessage) await oldMessage.delete().catch(() => {});

        const panel = await queue.textChannel.send(createPanel(queue, song));
        controlMessages.set(queue.id, panel);
    } catch (error) {}
});

distube.on("finishSong", queue => {
    const guild = client.guilds.cache.get(queue.id);
    if (!guild) return;
    if (!getGuildData(guild.id).mode247) scheduleLeave(guild);
});

distube.on("finish", queue => {
    const guild = client.guilds.cache.get(queue.id);
    if (!guild) return;
    if (!getGuildData(guild.id).mode247) scheduleLeave(guild);
});

distube.on("disconnect", queue => {
    const guild = client.guilds.cache.get(queue.id);
    if (!guild) return;
    clearLeaveTimer(guild.id);
    controlMessages.delete(guild.id);
    textChannels.delete(guild.id);
});

distube.on("error", async (error, queue) => {
    if (queue && queue.textChannel) {
        queue.textChannel.send("❌ حدث خطأ أثناء تشغيل هذه الأغنية.").catch(() => {});
    }
});

// ======================================================
// READY & LOGIN
// ======================================================

client.once("ready", async () => {
    console.log(`🔴 RED MUSIC ONLINE: ${client.user.tag}`);
    await registerCommands(client);

    client.user.setPresence({
        activities: [{ name: "RED MUSIC 🎵", type: 2 }],
        status: "online"
    });
});

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

client.login(TOKEN);
