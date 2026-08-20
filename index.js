npm install @discordjs/opus ffmpeg-static && cat << 'EOF' > index.js
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { DisTube } = require('distube');
const { SoundCloudPlugin } = require('@distube/soundcloud');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    plugins: [new SoundCloudPlugin()]
});

const commands = [
    new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel'),
    new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or search by name')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('Song name or URL')
                .setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear queue')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);
    
    const rest = new REST({ version: '10' }).setToken(client.token);
    try {
        console.log('Cleaning up duplicate slash commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        
        console.log('Registering fresh slash commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Slash commands registered clean and successfully!');
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
});

distube.on('playSong', (queue, song) => {
    queue.textChannel?.send(`▶️ Playing: **${song.name}**`);
});

distube.on('addSong', (queue, song) => {
    queue.textChannel?.send(`✅ Added to queue: **${song.name}**`);
});

distube.on('error', (channel, e) => {
    if (channel) channel.send(`Error: ${e.message.slice(0, 150)}`);
    else console.error(e);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, guild, channel } = interaction;
    const voiceChannel = member.voice.channel;

    if (commandName === 'join') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        distube.voices.join(voiceChannel);
        return interaction.reply('Joined the voice channel.');
    }

    if (commandName === 'leave') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        distube.voices.leave(guild);
        return interaction.reply('Left the voice channel.');
    }

    if (commandName === 'play') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        const query = interaction.options.getString('query');
        await interaction.deferReply();
        try {
            await distube.play(voiceChannel, query, {
                textChannel: channel,
                member: member
            });
            await interaction.editReply(`Searching and playing: **${query}**`);
        } catch (err) {
            await interaction.editReply('Could not find or play the requested track.');
        }
        return;
    }

    if (commandName === 'skip') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        try {
            await distube.skip(interaction);
            interaction.reply('Skipped the song.');
        } catch (e) {
            interaction.reply({ content: 'There is no next song to skip.', ephemeral: true });
        }
        return;
    }

    if (commandName === 'stop') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        distube.stop(interaction);
        return interaction.reply('Stopped playback and cleared the queue.');
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('5')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const voiceChannel = message.member.voice.channel;

    if (command === 'join') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        distube.voices.join(voiceChannel);
        return message.reply('Joined the voice channel.');
    }

    if (command === 'leave') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        distube.voices.leave(message.guild);
        return message.reply('Left the voice channel.');
    }

    if (command === 'p' || command === 'play') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        const query = args.join(' ');
        if (!query) return message.reply('Please provide a song name or link!');
        
        try {
            await distube.play(voiceChannel, query, {
                textChannel: message.channel,
                member: message.member,
                message
            });
        } catch (err) {
            message.reply('Could not play this track.');
        }
        return;
    }

    if (command === 'skip') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        try {
            await distube.skip(message);
            message.reply('Skipped the song.');
        } catch (e) {
            message.reply('There is no next song to skip.');
        }
        return;
    }

    if (command === 'stop') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        distube.stop(message);
        return message.reply('Stopped playback and cleared the queue.');
    }
});

client.login(process.env.TOKEN);
EOF
sed -i "s/client.login.*/client.login('ضع_التوكن_الجديد_هنا');/" index.js
cat << 'EOF' > index.js
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { DisTube } = require('distube');
const { SoundCloudPlugin } = require('@distube/soundcloud');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    plugins: [new SoundCloudPlugin()]
});

function createControlPanel(song, queue) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`🎶 Playing: ${song.name}`)
        .addFields(
            { name: 'Duration', value: `${song.formattedDuration}`, inline: true },
            { name: 'Requested by', value: `${song.user}`, inline: true },
            { name: 'Queue Status', value: `${queue.songs.length} track(s) in queue`, inline: true }
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_resume').setEmoji('▶️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
    );

    return { embeds: [embed], components: [row1] };
}

distube.on('playSong', (queue, song) => {
    queue.textChannel?.send(createControlPanel(song, queue));
});

distube.on('addSong', (queue, song) => {
    queue.textChannel?.send(`🎵 **${song.name}** added to queue! Position: **${queue.songs.length}**`);
});

distube.on('error', (channel, e) => {
    if (channel) channel.send(`⚠️ Error: ${e.message.slice(0, 150)}`);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const queue = distube.getQueue(interaction.guildId);
    if (!queue) return interaction.reply({ content: 'No music currently playing.', ephemeral: true });

    const memberVoice = interaction.member.voice.channel;
    if (!memberVoice) return interaction.reply({ content: 'You must be in a voice channel!', ephemeral: true });

    if (interaction.customId === 'btn_pause') {
        if (queue.paused) return interaction.reply({ content: 'Already paused.', ephemeral: true });
        distube.pause(interaction.guildId);
        return interaction.reply({ content: '⏸️ Paused playback.', ephemeral: true });
    }

    if (interaction.customId === 'btn_resume') {
        if (!queue.paused) return interaction.reply({ content: 'Already playing.', ephemeral: true });
        distube.resume(interaction.guildId);
        return interaction.reply({ content: '▶️ Resumed playback.', ephemeral: true });
    }

    if (interaction.customId === 'btn_skip') {
        try {
            await distube.skip(interaction.guildId);
            return interaction.reply({ content: '⏭️ Skipped track.', ephemeral: true });
        } catch (e) {
            return interaction.reply({ content: 'No next track to skip to.', ephemeral: true });
        }
    }

    if (interaction.customId === 'btn_stop') {
        distube.stop(interaction.guildId);
        return interaction.reply({ content: '⏹️ Stopped and cleared queue.', ephemeral: true });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('5')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const voiceChannel = message.member.voice.channel;

    if (command === 'p' || command === 'play') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        const query = args.join(' ');
        if (!query) return message.reply('Please provide a song name or link!');
        
        try {
            await distube.play(voiceChannel, query, {
                textChannel: message.channel,
                member: message.member,
                message
            });
        } catch (err) {
            message.reply('Could not play this track.');
        }
        return;
    }

    if (command === 'pause') {
        const queue = distube.getQueue(message.guildId);
        if (queue) {
            distube.pause(message.guildId);
            message.reply('⏸️ Paused the music (Queue saved).');
        }
        return;
    }

    if (command === 'resume') {
        const queue = distube.getQueue(message.guildId);
        if (queue) {
            distube.resume(message.guildId);
            message.reply('▶️ Resumed playing.');
        }
        return;
    }

    if (command === 'skip') {
        try {
            await distube.skip(message);
            message.reply('⏭️ Skipped.');
        } catch (e) {
            message.reply('No next track.');
        }
        return;
    }

    if (command === 'leave') {
        if (voiceChannel) distube.voices.leave(message.guild);
        return message.reply('Left the voice channel.');
    }
});

client.login(process.env.TOKEN);
EOF
npm install libsodium-wrappers @discordjs/voice
cat << 'EOF' > index.js
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { DisTube } = require('distube');
const { SoundCloudPlugin } = require('@distube/soundcloud');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    plugins: [new SoundCloudPlugin()]
});

const commands = [
    new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel'),
    new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or search by name')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('Song name or URL')
                .setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear queue')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);
    
    const rest = new REST({ version: '10' }).setToken(client.token);
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
});

distube.on('playSong', (queue, song) => {
    queue.textChannel?.send(`▶️ Playing: **${song.name}**`);
});

distube.on('addSong', (queue, song) => {
    queue.textChannel?.send(`✅ Added to queue: **${song.name}**`);
});

distube.on('error', (channel, e) => {
    if (channel) channel.send(`Error: ${e.message.slice(0, 150)}`);
    else console.error(e);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, guild, channel } = interaction;
    const voiceChannel = member.voice.channel;

    if (commandName === 'join') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        distube.voices.join(voiceChannel);
        return interaction.reply('Joined the voice channel.');
    }

    if (commandName === 'leave') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        distube.voices.leave(guild);
        return interaction.reply('Left the voice channel.');
    }

    if (commandName === 'play') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        const query = interaction.options.getString('query');
        await interaction.deferReply();
        try {
            await distube.play(voiceChannel, query, {
                textChannel: channel,
                member: member
            });
            await interaction.editReply(`Searching and playing: **${query}**`);
        } catch (err) {
            await interaction.editReply('Could not find or play the requested track.');
        }
        return;
    }

    if (commandName === 'skip') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        try {
            await distube.skip(interaction);
            interaction.reply('Skipped the song.');
        } catch (e) {
            interaction.reply({ content: 'There is no next song to skip.', ephemeral: true });
        }
        return;
    }

    if (commandName === 'stop') {
        if (!voiceChannel) return interaction.reply({ content: 'You must be in a voice channel first!', ephemeral: true });
        distube.stop(interaction);
        return interaction.reply('Stopped playback and cleared the queue.');
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('5')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const voiceChannel = message.member.voice.channel;

    if (command === 'join') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        distube.voices.join(voiceChannel);
        return message.reply('Joined the voice channel.');
    }

    if (command === 'leave') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        distube.voices.leave(message.guild);
        return message.reply('Left the voice channel.');
    }

    if (command === 'p' || command === 'play') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        const query = args.join(' ');
        if (!query) return message.reply('Please provide a song name or link!');
        
        try {
            await distube.play(voiceChannel, query, {
                textChannel: message.channel,
                member: message.member,
                message
            });
        } catch (err) {
            message.reply('Could not play this track.');
        }
        return;
    }

    if (command === 'skip') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        try {
            await distube.skip(message);
            message.reply('Skipped the song.');
        } catch (e) {
            message.reply('There is no next song to skip.');
        }
        return;
    }

    if (command === 'stop') {
        if (!voiceChannel) return message.reply('You must be in a voice channel first!');
        distube.stop(message);
        return message.reply('Stopped playback and cleared the queue.');
    }
});

client.login(process.env.TOKEN);
EOF
npm install libsodium-wrappers @discordjs/voice

