// ---------------- IMPORTS ----------------
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
require("dotenv").config();
const express = require("express");

// ---------------- CLIENT SETUP ----------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Giveaway storage
const activeGiveaways = new Map();
const endedGiveaways = new Map();

// ---------------- TIME PARSER ----------------
function parseTime(timeStr) {
    const regex = /((\d+)h)?((\d+)m)?((\d+)s)?/;
    const match = timeStr.match(regex);
    if (!match) return null;

    const hours = parseInt(match[2]) || 0;
    const minutes = parseInt(match[4]) || 0;
    const seconds = parseInt(match[6]) || 0;

    return (hours * 3600) + (minutes * 60) + seconds;
}

// ---------------- BOT READY ----------------
client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    registerSlashCommands();
});

// ---------------- REACTION HANDLER (JOIN GIVEAWAY) ----------------
client.on("messageReactionAdd", async (reaction, user) => {
    if (reaction.partial) await reaction.fetch();
    if (user.bot) return;
    if (reaction.emoji.name !== "🎉") return;

    const giveaway = activeGiveaways.get(reaction.message.id);
    if (!giveaway) return;

    // DM player when they join
    try {
        const joinEmbed = new EmbedBuilder()
            .setTitle("🎉 Entry Approved! 🎉")
            .setDescription(`Your entry to **${giveaway.prize}** has been approved!\nYou have a chance to win!!`)
            .addFields({ name: "Owner", value: `${giveaway.host.tag}` })
            .setColor(0x00ff99)
            .setFooter({ text: "Giveaway Bot • Good luck!" })
            .setTimestamp();

        await user.send({ embeds: [joinEmbed] });
    } catch (err) {
        console.log(`❌ Could not DM ${user.tag}`);
    }
});

// ---------------- COMMAND HANDLER ----------------
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
        case "start": return handleStart(interaction);
        case "end": return handleEnd(interaction);
        case "pause": return handlePause(interaction);
        case "recol": return handleReroll(interaction);
        case "active": return handleActive(interaction);
        case "ended": return handleEnded(interaction);
        case "help": return handleHelp(interaction);
    }
});

// ---------------- COMMAND FUNCTIONS ----------------
async function handleStart(interaction) {
    const duration = interaction.options.getString("duration");
    const winners = interaction.options.getInteger("winners");
    const prize = interaction.options.getString("prize");

    const seconds = parseTime(duration);
    if (!seconds) {
        return interaction.reply({ 
            content: "⚠️ Invalid time format! Use like `1h2m10s`.", 
            ephemeral: true 
        });
    }

    const giveawayEmbed = new EmbedBuilder()
        .setTitle("🎉 GIVEAWAY TIME! 🎉")
        .setDescription(`**Prize:** ${prize}`)
        .addFields(
            { name: "Hosted by", value: `${interaction.user}`, inline: true },
            { name: "Duration", value: `${duration}`, inline: true },
            { name: "Winners", value: `${winners}`, inline: true },
            { name: "Status", value: "🟢 Active", inline: true }
        )
        .setColor(0x00ff99)
        .setFooter({ text: "React with 🎉 to join!" })
        .setTimestamp();

    const message = await interaction.channel.send({ embeds: [giveawayEmbed] });
    await message.react("🎉");

    activeGiveaways.set(message.id, {
        prize,
        winners,
        host: interaction.user,
        channel: interaction.channel,
        paused: false
    });

    await interaction.reply({ 
        content: `✅ Giveaway started for **${prize}** (ID: \`${message.id}\`)`, 
        ephemeral: true 
    });

    // Auto end
    setTimeout(() => endGiveaway(message.id, interaction, true), seconds * 1000);
}

async function handleEnd(interaction) {
    const messageId = interaction.options.getString("message_id");
    await endGiveaway(messageId, interaction, false);
}

async function handlePause(interaction) {
    const messageId = interaction.options.getString("message_id");
    const giveaway = activeGiveaways.get(messageId);

    if (!giveaway) {
        return interaction.reply({ content: "⚠️ Giveaway not found!", ephemeral: true });
    }

    giveaway.paused = !giveaway.paused;
    activeGiveaways.set(messageId, giveaway);

    return interaction.reply({ 
        content: giveaway.paused ? "⏸ Giveaway paused!" : "▶ Giveaway resumed!" 
    });
}

async function handleReroll(interaction) {
    const messageId = interaction.options.getString("message_id");
    const giveaway = endedGiveaways.get(messageId);

    if (!giveaway) {
        return interaction.reply({ content: "⚠️ Giveaway not found or not ended yet!", ephemeral: true });
    }

    const cacheMsg = await giveaway.channel.messages.fetch(messageId);
    const reaction = cacheMsg.reactions.cache.get("🎉");
    const users = reaction ? (await reaction.users.fetch()).filter(u => !u.bot).map(u => u) : [];

    if (!users.length) {
        return interaction.reply({ content: "😢 No participants found to reroll.", ephemeral: true });
    }

    const winners = users.sort(() => 0.5 - Math.random()).slice(0, giveaway.winners);
    const winMentions = winners.map(w => w.toString()).join(", ");

    await giveaway.channel.send(`🔄 Reroll result: ${winMentions} won **${giveaway.prize}** 🎁`);

    // DM the winners
    for (const winner of winners) {
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle("🔄 Giveaway Rerolled")
                .setDescription(`You won the reroll for **${giveaway.prize}** 🎁`)
                .setColor(0xe67e22)
                .setTimestamp();
            await winner.send({ embeds: [dmEmbed] });
        } catch (err) {
            console.log(`❌ Could not DM ${winner.tag}`);
        }
    }

    return interaction.reply({ content: "✅ Giveaway rerolled!", ephemeral: true });
}

async function handleActive(interaction) {
    if (activeGiveaways.size === 0) {
        return interaction.reply({ content: "⚠️ No active giveaways right now!", ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setTitle("🎁 Active Giveaways")
        .setColor(0x1abc9c)
        .setTimestamp();

    for (const [id, g] of activeGiveaways) {
        embed.addFields({
            name: g.prize,
            value: `Hosted by: ${g.host}\nChannel: ${g.channel}\nPaused: ${g.paused ? "Yes" : "No"}\nID: \`${id}\``
        });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleEnded(interaction) {
    if (endedGiveaways.size === 0) {
        return interaction.reply({ content: "⚠️ No ended giveaways yet!", ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setTitle("🏆 Ended Giveaways")
        .setColor(0xe74c3c)
        .setTimestamp();

    for (const [id, g] of endedGiveaways) {
        embed.addFields({
            name: g.prize,
            value: `Hosted by: ${g.host}\nChannel: ${g.channel}\nWinners: ${g.winners}\nID: \`${id}\``
        });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleHelp(interaction) {
    const helpEmbed = new EmbedBuilder()
        .setTitle("🎁 Giveaway Bot Help")
        .setDescription("Here are all the available commands:")
        .setColor(0x3498db)
        .addFields(
            { name: "/start <duration> <winners> <prize>", value: "Start a new giveaway" },
            { name: "/end <message_id>", value: "End a giveaway early" },
            { name: "/pause <message_id>", value: "Pause or resume a giveaway" },
            { name: "/recol <message_id>", value: "Reroll winners for an ended giveaway" },
            { name: "/active", value: "Show all active giveaways" },
            { name: "/ended", value: "Show all ended giveaways" },
            { name: "/help", value: "Show this help message" }
        )
        .setFooter({ text: "Giveaway Bot • All commands listed above" })
        .setTimestamp();

    await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
}

// ---------------- END GIVEAWAY ----------------
async function endGiveaway(messageId, interaction, auto) {
    const giveaway = activeGiveaways.get(messageId);
    if (!giveaway) {
        if (!auto) await interaction.reply("⚠️ Giveaway not found or already ended!");
        return;
    }

    const cacheMsg = await giveaway.channel.messages.fetch(messageId);
    const reaction = cacheMsg.reactions.cache.get("🎉");
    const users = reaction ? (await reaction.users.fetch()).filter(u => !u.bot).map(u => u) : [];

    if (!users.length) {
        await giveaway.channel.send("😢 No one joined the giveaway.");
    } else {
        const winners = users.sort(() => 0.5 - Math.random()).slice(0, giveaway.winners);
        const winMentions = winners.map(w => w.toString()).join(", ");
        await giveaway.channel.send(`🏆 Congratulations ${winMentions}! You won **${giveaway.prize}** 🎁`);

        // DM winners
        for (const winner of winners) {
            try {
                const winEmbed = new EmbedBuilder()
                    .setTitle("🏆 YOU WON THE GIVEAWAY! 🏆")
                    .setDescription(`🎁 Prize: **${giveaway.prize}**\n\n✨ Congratulations, enjoy your reward!`)
                    .addFields({ name: "Hosted by", value: `${giveaway.host}` })
                    .setColor(0xf1c40f)
                    .setFooter({ text: "Giveaway Bot • Enjoy your prize!" })
                    .setTimestamp();

                await winner.send({ embeds: [winEmbed] });
            } catch (err) {
                console.log(`❌ Could not DM ${winner.tag}`);
            }
        }
    }

    endedGiveaways.set(messageId, giveaway);
    activeGiveaways.delete(messageId);
}

// ---------------- REGISTER SLASH COMMANDS ----------------
async function registerSlashCommands() {
    const data = [
        {
            name: "start",
            description: "Start a giveaway",
            options: [
                { name: "duration", description: "Duration (e.g. 1h2m)", type: 3, required: true },
                { name: "winners", description: "Number of winners", type: 4, required: true },
                { name: "prize", description: "Prize", type: 3, required: true }
            ]
        },
        { name: "end", description: "Manually end a giveaway", options: [{ name: "message_id", description: "Giveaway message ID", type: 3, required: true }] },
        { name: "pause", description: "Pause or resume a giveaway", options: [{ name: "message_id", description: "Giveaway message ID", type: 3, required: true }] },
        { name: "recol", description: "Reroll winners for a giveaway", options: [{ name: "message_id", description: "Giveaway message ID", type: 3, required: true }] },
        { name: "active", description: "Show all active giveaways" },
        { name: "ended", description: "Show all ended giveaways" },
        { name: "help", description: "Show help for giveaway bot" }
    ];

    await client.application.commands.set(data);
    console.log("✅ Slash commands registered!");
}

// ---------------- EXPRESS KEEPALIVE ----------------
const app = express();
const port = process.env.PORT || 4000;
app.get("/", (req, res) => res.send("Giveaway Bot is running!"));
app.listen(port, () => console.log(`🌐 Web server listening on port ${port}`));

// ---------------- RUN BOT ----------------
client.login(process.env.TOKEN);

