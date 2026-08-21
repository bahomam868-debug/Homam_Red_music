// ======================================================
// SERVER & DEPENDENCIES
// ======================================================
const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('RED MUSIC is running fast!\n');
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
// DATA DATABASE
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
            update: true,
            args: [
                "--extractor-args", "youtube:player_client=default,android,tv,web",
                "--no-check-certificates",
                "--geo-bypass",
                "--prefer-free-formats",
                "--youtube-skip-dash-manifest"
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
// HELPERS & ELEGANT EMBEDS
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
    if (!duration || duration <= 0) return "▬".repeat(total);
    const position = Math.min(total - 1, Math.floor((current / duration) * total));
    return "▬".repeat(position) + "🔘" + "▬".repeat(total - position - 1);
}

function clearLeaveTimer(guildId) {
    const timer = leaveTimers.get(guildId);
    if (timer) {
        clearTimeout(timer);
        leaveTimers.delete(guildId);
    }
}

function voiceError(member) {
    if (!member.voice?.channel) return "يجب عليك الدخول إلى روم صوتي أولاً لاستخدام هذا الأمر.";
    const botChannel = getBotVoiceChannel(member.guild);
    if (botChannel && botChannel.id !== member.voice.channel.id) {
        return "يجب أن تكون في نفس الروم الصوتي مع البوت لتتمكن من التحكم به.";
    }
    return null;
}

function sendElegant(channel, title, description, color = RED) {
    if (!channel?.isTextBased()) return;
    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: "R E D   M U S I C", iconURL: client.user.displayAvatarURL() })
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: "Super Fast Audio Engine", iconURL: client.user.displayAvatarURL() });
    
    return channel.send({ embeds: [embed] }).catch(() => {});
}

// ======================================================
// AUTO LEAVE SYSTEM
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
                    sendElegant(channel, "👋 مغادرة الروم الصوتي", "تم مغادرة الروم الصوتي لعدم وجود أي نشاط موسيقي حالياً.");
                }
            }
        } catch (error) {}
    }, IDLE_LEAVE_TIME);

    leaveTimers.set(guild.id, timer);
}

// ======================================================
// ELEGANT CONTROL PANEL EMBED
// ======================================================

function createPanel(queue, song) {
    const current = queue.currentTime || 0;
    const duration = song.duration || queue.duration || 0;
    const requestedBy = song.user ? `<@${song.user.id}>` : "Unknown";

    const embed = new EmbedBuilder()
        .setColor(RED)
        .setAuthor({ name: "🎶  R E D   M U S I C   P L A Y E R", iconURL: client.user.displayAvatarURL() })
        .setTitle(`🎵  ${song.name || "Unknown Track"}`)
        .setDescription(
            [
                `\`${progressBar(current, duration)}\``,
                `⏱️ **[ ${formatTime(current)} / ${formatTime(duration)} ]**`,
                "",
                `👤 **Requested By:** ${requestedBy}`,
                `🔊 **Volume Level:** \`${queue.volume}%\``,
                `🔁 **Loop Status:** \`${queue.repeatMode === 0 ? "OFF" : queue.repeatMode === 1 ? "SONG" : "QUEUE"}\``
            ].join("\n")
        )
        .setFooter({ text: "Powered by Red System • High Speed Engine", iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    if (song.thumbnail) embed.setImage(song.thumbnail);
    if (song.url) embed.setURL(song.url);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("previous").setEmoji("⏮️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("back10").setEmoji("⏪").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("pause").setEmoji("⏸️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("resume").setEmoji("▶️").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("forward10").setEmoji("⏩").setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("loop").setEmoji("🔁").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("queue").setEmoji("📋").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("volumeDown").setEmoji("🔉").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("volumeUp").setEmoji("🔊").setStyle(ButtonStyle.Secondary),
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
    if (!queue || !queue.songs?.length) return "📭 قائمة الانتظار فارغة حالياً.";
    return queue.songs
        .slice(0, 15)
        .map((song, index) => {
            if (index === 0) return `▶️ **[Playing Now]** ${song.name} \`(${song.formattedDuration || "Live"})\``;
            return `\`${index}.\` ${song.name} \`(${song.formattedDuration || "Live"})\``;
        })
        .join("\n");
}

// ======================================================
// SLASH COMMANDS SETUP (جميع أوامر السلاش)
// ======================================================

const commands = [
    new SlashCommandBuilder().setName("play").setDescription("تشغيل أغنية عبر الرابط أو الاسم").addStringOption(o => o.setName("song").setDescription("اسم الأغنية أو الرابط").setRequired(true)),
    new SlashCommandBuilder().setName("playlist").setDescription("عرض قائمة التشغيل الحالية"),
    new SlashCommandBuilder().setName("lista").setDescription("عرض قائمة التشغيل الحالية"),
    new SlashCommandBuilder().setName("stop").setDescription("إيقاف الموسيقى وإخراج البوت"),
    new SlashCommandBuilder().setName("pause").setDescription("إيقاف مؤقت للموسيقى"),
    new SlashCommandBuilder().setName("resume").setDescription("استئناف تشغيل الموسيقى"),
    new SlashCommandBuilder().setName("skip").setDescription("تخطي الأغنية الحالية"),
    new SlashCommandBuilder().setName("seek").setDescription("الانتقال إلى ثانية محددة في الأغنية").addIntegerOption(o => o.setName("seconds").setDescription("رقم الثانية").setRequired(true).setMinValue(0)),
    new SlashCommandBuilder().setName("join").setDescription("انضمام البوت لرومك الصوتي"),
    new SlashCommandBuilder().setName("leave").setDescription("خروج البوت من الروم الصوتي"),
    new SlashCommandBuilder().setName("247").setDescription("تفعيل أو إلغاء نظام التواجد الدائم 24/7"),
    new SlashCommandBuilder().setName("ping").setDescription("فحص سرعة استجابة البوت")
].map(c => c.toJSON());

async function registerCommands(clientInstance) {
    if (!clientInstance.user) return;
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
        // تسجيل الأوامر على مستوى السيرفرات لضمان ظهورها الفوري، أو العالمية
        await rest.put(Routes.applicationCommands(clientInstance.user.id), { body: commands });
        console.log("✅ تم تسجيل جميع أوامر السلاش بنجاح.");
    } catch (error) {
        console.error("❌ خطأ في تسجيل أوامر السلاش:", error);
    }
}

// ======================================================
// BUTTONS HANDLER
// ======================================================

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isButton()) return;

        const error = voiceError(interaction.member);
        if (error) return interaction.reply({ content: error, ephemeral: true });

        const queue = getQueue(interaction.guild.id);
        if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية تعمل حالياً.", ephemeral: true });

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

        if (command === "ping") return interaction.reply(`🏓 سرعة استجابة البوت: **${client.ws.ping}ms**`);

        if (command === "play") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });

            const query = interaction.options.getString("song");
            await interaction.deferReply();

            try {
                clearLeaveTimer(interaction.guild.id);
                textChannels.set(interaction.guild.id, interaction.channel.id);
                
                const queue = getQueue(interaction.guild.id);
                const isPlaying = queue && queue.songs && queue.songs.length > 0;

                await distube.play(member.voice.channel, query, {
                    member,
                    textChannel: interaction.channel,
                    metadata: { requestedBy: member.id }
                });

                if (isPlaying) {
                    await interaction.editReply(`✅ تم الإضافة للتشغيل التلقائي التالي.`);
                } else {
                    await interaction.editReply(`✅ تم التشغيل.`);
                }
            } catch (err) {
                await interaction.editReply(`❌ عذراً، لم أتمكن من معالجة الرابط أو العثور على الأغنية.`);
            }
            return;
        }

        if (command === "playlist" || command === "lista" || command === "queue") {
            return interaction.reply(queueText(getQueue(interaction.guild.id)));
        }

        if (command === "pause") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية تعمل.", ephemeral: true });
            await queue.pause();
            await updatePanel(interaction.guild.id);
            return interaction.reply("⏸️ تم إيقاف الموسيقى مؤقتاً.");
        }

        if (command === "stop") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية تعمل.", ephemeral: true });
            await queue.stop();
            return interaction.reply("⏹️ تم إيقاف الموسيقى ومسح القائمة.");
        }

        if (command === "resume") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية تعمل.", ephemeral: true });
            await queue.resume();
            await updatePanel(interaction.guild.id);
            return interaction.reply("▶️ تم استئناف تشغيل الموسيقى.");
        }

        if (command === "skip") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية تعمل.", ephemeral: true });
            await queue.skip();
            return interaction.reply("⏭️ تم تخطي الأغنية الحالية.");
        }

        if (command === "seek") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });
            const queue = getQueue(interaction.guild.id);
            if (!queue) return interaction.reply({ content: "❌ لا توجد أغنية تعمل.", ephemeral: true });
            const seconds = interaction.options.getInteger("seconds");
            await queue.seek(seconds);
            return interaction.reply(`⏩ تم الانتقال إلى الثانية: **${seconds}**`);
        }

        if (command === "join") {
            if (!member.voice?.channel) return interaction.reply("❌ يجب عليك دخول روم صوتي أولاً.");
            clearLeaveTimer(interaction.guild.id);
            textChannels.set(interaction.guild.id, interaction.channel.id);
            await distube.voices.join(member.voice.channel);
            return interaction.reply(`🔊 انضممت إلى روم الصوت: **${member.voice.channel.name}**`);
        }

        if (command === "leave") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });
            const guildData = getGuildData(interaction.guild.id);
            if (guildData.mode247) return interaction.reply("🔴 وضع 24/7 مفعل حالياً، لا يمكنني مغادرة الروم.");
            clearLeaveTimer(interaction.guild.id);
            await distube.voices.leave(interaction.guild.id);
            return interaction.reply("👋 تم الخروج من الروم الصوتي بنجاح.");
        }

        if (command === "247") {
            const err = voiceError(member);
            if (err) return interaction.reply({ content: err, ephemeral: true });
            const guildData = getGuildData(interaction.guild.id);
            guildData.mode247 = !guildData.mode247;
            saveData();
            if (guildData.mode247) {
                clearLeaveTimer(interaction.guild.id);
                return interaction.reply("🔴 **تم تفعيل وضع التواجد الدائم (24/7) بنجاح.**");
            }
            return interaction.reply("⚫ **تم إيقاف وضع التواجد الدائم (24/7).**");
        }

    } catch (e) {}
});

// ======================================================
// PREFIX COMMANDS SYSTEM (5p, 5play, 5list, etc.)
// ======================================================

client.on("messageCreate", async message => {
    try {
        if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

        const parts = message.content.trim().split(/\s+/);
        const command = parts.shift().toLowerCase();
        const args = parts;
        const member = message.member;

        if (command === "5command") {
            const embed = new EmbedBuilder()
                .setColor(RED)
                .setAuthor({ name: "RED MUSIC COMMANDS", iconURL: client.user.displayAvatarURL() })
                .setTitle("📜 قائمة الأوامر الشاملة الفورية")
                .setDescription(
                    [
                        "**🎵 MUSIC & PLAY**",
                        "`/play <song>` • `5p <song>` • `5play <song>`",
                        "",
                        "**📋 PLAYLIST SYSTEM**",
                        "`5list create <name>` - إنشاء قائمة جديدة",
                        "`5list add <name> <song>` - إضافة أغنية للقائمة",
                        "`5list show` - عرض القوائم المحفوظة",
                        "`5list play <name>` - تشغيل قائمة كاملة",
                        "",
                        "**🎧 CONTROL & QUEUE**",
                        "`/playlist` • `/lista` • `5queue`",
                        "`/stop` • `/pause` • `/resume` • `/skip` • `/seek`",
                        "`5stop` • `5pause` • `5resume` • `5skip` • `5remove <number>`",
                        "",
                        "**🔊 VOICE & SYSTEM**",
                        "`/join` • `/leave` • `/247` • `/ping`",
                        "`5join` • `5leave` • `5247` • `5ping`"
                    ].join("\n")
                )
                .setFooter({ text: "Super Fast Engine Integration" });
            return message.channel.send({ embeds: [embed] });
        }

        if (command === "5p" || command === "5play") {
            const query = args.join(" ");
            if (!query) return sendElegant(message.channel, "❌ تنبيه بالطلب", "يرجى كتابة اسم الأغنية أو الرابط المطلوب بجانب الأمر.");

            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ في الصوتي", err);

            try {
                clearLeaveTimer(message.guild.id);
                textChannels.set(message.guild.id, message.channel.id);
                
                const queue = getQueue(message.guild.id);
                const isPlaying = queue && queue.songs && queue.songs.length > 0;

                await distube.play(member.voice.channel, query, {
                    member,
                    textChannel: message.channel,
                    metadata: { requestedBy: member.id }
                });

                if (isPlaying) {
                    await sendElegant(message.channel, "🎵 تم الإضافة", "✅ تم الإضافة للتشغيل التلقائي التالي.");
                } else {
                    await sendElegant(message.channel, "🎵 تم التشغيل", "✅ جاري تشغيل طلبك فوراً.");
                }
            } catch (err) {
                await sendElegant(message.channel, "❌ خطأ في التشغيل", "عذراً، لم أتمكن من معالجة هذا الرابط أو العثور على الأغنية.");
            }
            return;
        }

        if (command === "5stop") {
            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ", err);
            const queue = getQueue(message.guild.id);
            if (!queue) return sendElegant(message.channel, "❌ تنبيه", "لا توجد أي أغنية تعمل حالياً.");
            await queue.stop();
            return sendElegant(message.channel, "⏹️ إيقاف الموسيقى", "تم إيقاف الموسيقى ومسح قائمة الانتظار.");
        }

        if (command === "5pause") {
            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ", err);
            const queue = getQueue(message.guild.id);
            if (!queue) return sendElegant(message.channel, "❌ تنبيه", "لا توجد أغنية تعمل لإيقافها.");
            await queue.pause();
            await updatePanel(message.guild.id);
            return sendElegant(message.channel, "⏸️ إيقاف مؤقت", "تم إيقاف التشغيل مؤقتاً.");
        }

        if (command === "5resume") {
            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ", err);
            const queue = getQueue(message.guild.id);
            if (!queue) return sendElegant(message.channel, "❌ تنبيه", "لا توجد أغنية متوقفة حالياً.");
            await queue.resume();
            await updatePanel(message.guild.id);
            return sendElegant(message.channel, "▶️ استئناف التشغيل", "تم استئناف تشغيل الموسيقى.");
        }

        if (command === "5skip") {
            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ", err);
            const queue = getQueue(message.guild.id);
            if (!queue) return sendElegant(message.channel, "❌ تنبيه", "لا توجد أغنية لتخطيها.");
            await queue.skip();
            return sendElegant(message.channel, "⏭️ تخطي الأغنية", "تم تخطي الأغنية الحالية بنجاح.");
        }

        if (command === "5join") {
            if (!member.voice?.channel) return sendElegant(message.channel, "❌ خطأ", "يجب عليك دخول روم صوتي أولاً.");
            clearLeaveTimer(message.guild.id);
            textChannels.set(message.guild.id, message.channel.id);
            await distube.voices.join(member.voice.channel);
            return sendElegant(message.channel, "🔊 انضمام للروم", `تم الانضمام بنجاح إلى روم: **${member.voice.channel.name}**`);
        }

        if (command === "5leave") {
            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ", err);
            const guildData = getGuildData(message.guild.id);
            if (guildData.mode247) return sendElegant(message.channel, "🔴 وضع 24/7", "وضع 24/7 مفعل، لا يمكنني الخروج الآن.");
            clearLeaveTimer(message.guild.id);
            await distube.voices.leave(message.guild.id);
            return sendElegant(message.channel, "👋 مغادرة الروم", "تم الخروج من الروم الصوتي بنجاح.");
        }

        if (command === "5247") {
            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ", err);
            const guildData = getGuildData(message.guild.id);
            guildData.mode247 = !guildData.mode247;
            saveData();
            if (guildData.mode247) {
                clearLeaveTimer(message.guild.id);
                return sendElegant(message.channel, "🔴 نظام 24/7", "تم تفعيل وضع التواجد الدائم بنجاح.");
            }
            return sendElegant(message.channel, "⚫ نظام 24/7", "تم إيقاف وضع التواجد الدائم.");
        }

        if (command === "5ping") {
            return sendElegant(message.channel, "🏓 سرعة البوت", `سرعة استجابة السيرفر الحالية: **${client.ws.ping}ms**`);
        }

        if (command === "5queue") {
            return sendElegant(message.channel, "📋 قائمة الانتظار", queueText(getQueue(message.guild.id)));
        }

        if (command === "5remove") {
            const err = voiceError(member);
            if (err) return sendElegant(message.channel, "❌ خطأ", err);
            const queue = getQueue(message.guild.id);
            if (!queue) return sendElegant(message.channel, "❌ خطأ", "لا توجد قائمة تشغيل نشطة.");
            
            const index = parseInt(args[0]);
            if (!index || index <= 1 || index >= queue.songs.length) {
                return sendElegant(message.channel, "❌ خطأ في الرقم", "يرجى إدخال رقم صحيح لعنصر في القائمة (لا يمكن حذف الأغنية الحالية).");
            }
            
            const removed = queue.songs.splice(index, 1);
            return sendElegant(message.channel, "🗑️ إزالة أغنية", `تمت إزالة الأغنية بنجاح: **${removed[0].name}**`);
        }

        if (command === "5list") {
            const sub = (args.shift() || "").toLowerCase();
            const guildData = getGuildData(message.guild.id);

            if (sub === "create") {
                const name = args.join(" ").trim();
                if (!name) return sendElegant(message.channel, "❌ صيغة خاطئة", "الاستخدام الصحيح: `5list create <اسم القائمة>`");
                if (guildData.playlists[name]) return sendElegant(message.channel, "❌ مكرر", "هذه القائمة موجودة مسبقاً.");
                guildData.playlists[name] = [];
                saveData();
                return sendElegant(message.channel, "📋 إنشاء قائمة تشغيل", `تم إنشاء قائمة التشغيل الجديدة **${name}** بنجاح.`);
            }

            if (sub === "add") {
                const name = args.shift();
                const song = args.join(" ").trim();
                if (!name || !song) return sendElegant(message.channel, "❌ صيغة خاطئة", "الاستخدام الصحيح: `5list add <اسم القائمة> <الرابط أو اسم الأغنية>`");
                if (!guildData.playlists[name]) return sendElegant(message.channel, "❌ غير موجودة", "قائمة التشغيل هذه غير موجودة.");
                guildData.playlists[name].push(song);
                saveData();
                return sendElegant(message.channel, "🎵 إضافة لقائمة التشغيل", `تمت إضافة العنصر بنجاح إلى قائمة **${name}**.`);
            }

            if (sub === "show") {
                const names = Object.keys(guildData.playlists);
                if (!names.length) return sendElegant(message.channel, "📭 القوائم", "لا توجد أي قوائم تشغيل محفوظة في هذا السيرفر.");
                const listInfo = names.map(n => `📋 **${n}** ─── \`${guildData.playlists[n].length} أغاني\``).join("\n");
                return sendElegant(message.channel, "📋 قوائم التشغيل المحفوظة", listInfo);
            }

            if (sub === "play") {
                const name = args.join(" ").trim();
                const playlist = guildData.playlists[name];
                if (!playlist || !playlist.length) return sendElegant(message.channel, "❌ خطأ", "قائمة التشغيل غير موجودة أو أنها فارغة تماماً.");

                const err = voiceError(member);
                if (err) return sendElegant(message.channel, "❌ خطأ صوتي", err);

                clearLeaveTimer(message.guild.id);
                textChannels.set(message.guild.id, message.channel.id);

                for (const song of playlist) {
                    try {
                        await distube.play(member.voice.channel, song, {
                            member,
                            textChannel: message.channel,
                            metadata: { requestedBy: member.id }
                        });
                    } catch (e) {}
                }
                return sendElegant(message.channel, "🎶 تشغيل قائمة التشغيل", `جاري الآن إضافة وتجهيز تشغيل القائمة بالكامل: **${name}**`);
            }

            return sendElegant(message.channel, "📋 نظام قوائم التشغيل", [
                "الأوامر المتاحة للإدارة:",
                "`5list create <name>` - إنشاء قائمة جديدة",
                "`5list add <name> <song>` - إضافة أغنية للقائمة",
                "`5list show` - عرض جميع القوائم المحفوظة",
                "`5list play <name>` - تشغيل قائمة كاملة دفعة واحدة"
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
        sendElegant(queue.textChannel, "❌ خطأ تقني", "تعذر تشغيل هذا الرابط. تأكد من صحة الرابط أو أنه متاح للتشغيل العام.");
    }
});

// ======================================================
// READY & LOGIN
// ======================================================

client.once("ready", async () => {
    console.log(`🔴 RED MUSIC ONLINE & FAST: ${client.user.tag}`);
    await registerCommands(client);

    client.user.setPresence({
        activities: [{ name: "Super Fast Music • 5command", type: 2 }],
        status: "online"
    });
});

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

client.login(TOKEN);
