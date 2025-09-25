const { Client, GatewayIntentBits, Partials, EmbedBuilder, Collection } = require("discord.js");
require("dotenv").config();

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

// ---------- TIME PARSER ----------
function parseTime(timeStr) {
    const regex = /((\d+)h)?((\d+)m)?((\d+)s)?/;
    const match = timeStr.match(regex);
    if (!match) return null;
    const hours = parseInt(match[2]) || 0;
    const minutes = parseInt(match[4]) || 0;
    const seconds = parseInt(match[6]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
}

// ---------- BOT READY ----------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------- SLASH COMMANDS ----------
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "giveaway") {
        const duration = interaction.options.getString("duration");
        const winners = interaction.options.getInteger("winners");
        const prize = interaction.options.getString("prize");

        const seconds = parseTime(duration);
        if (!seconds) {
            return interaction.reply({ content: "⚠️ Invalid time format! Use like `1h2m10s`.", ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle("🎉 Giveaway 🎉")
            .setDescription(`**Prize:** ${prize}`)
            .addFields(
                { name: "Hosted by", value: interaction.user.toString() },
                { name: "Duration", value: duration },
                { name: "Number of winners", value: winners.toString() }
            )
            .setColor(0x00ff00);

        const message = await interaction.channel.send({ embeds: [embed] });
        await message.react("🎉");

        activeGiveaways.set(message.id, {
            prize,
            winners,
            host: interaction.user,
            channel: interaction.channel
        });

        await interaction.reply({ content: `✅ Giveaway started for **${prize}** (ID: \`${message.id}\`)`, ephemeral: true });

        // Auto end
        setTimeout(() => endGiveaway(message.id, interaction, true), seconds * 1000);
    }

    if (interaction.commandName === "end") {
        const messageId = interaction.options.getString("message_id");
        await endGiveaway(messageId, interaction, false);
    }

    if (interaction.commandName === "reroll") {
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

        winners.forEach(async (w) => {
            try {
                const embed = new EmbedBuilder()
                    .setTitle("🏆 YOU WON THE GIVEAWAY (REROLL)! 🏆")
                    .setDescription(`🎁 Prize: **${giveaway.prize}**\n\n✨ Congratulations, enjoy your reward!`)
                    .setColor(0xFFD700)
                    .setFooter({ text: `Hosted by: ${giveaway.host.username}` });
                await w.send({ embeds: [embed] });
            } catch {
                console.log(`Cannot DM ${w.username}`);
            }
        });
    }

    if (interaction.commandName === "giveaway_list") {
        const embed = new EmbedBuilder().setTitle("📋 Giveaway List").setColor(0x3498db);

        const activeText = activeGiveaways.size
            ? [...activeGiveaways.entries()]
                  .map(([id, g]) => `🟢 ID: \`${id}\` | Prize: **${g.prize}** | Winners: ${g.winners}`)
                  .join("\n")
            : "None";

        const endedText = endedGiveaways.size
            ? [...endedGiveaways.entries()]
                  .map(([id, g]) => `🔴 ID: \`${id}\` | Prize: **${g.prize}** | Winners: ${g.winnersList?.map(w => w.toString()).join(", ") || "None"}`)
                  .join("\n")
            : "None";

        embed.addFields(
            { name: "Active Giveaways", value: activeText, inline: false },
            { name: "Ended Giveaways", value: endedText, inline: false }
        );

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ---------- END GIVEAWAY ----------
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
        await giveaway.channel.send(`🎉 Congratulations ${winMentions}! You won **${giveaway.prize}** 🎁`);

        winners.forEach(async (w) => {
            try {
                const embed = new EmbedBuilder()
                    .setTitle("🏆 YOU WON THE GIVEAWAY! 🏆")
                    .setDescription(`🎁 Prize: **${giveaway.prize}**\n\n✨ Congratulations, enjoy your reward!`)
                    .setColor(0xFFD700)
                    .setFooter({ text: `Hosted by: ${giveaway.host.username}` });
                await w.send({ embeds: [embed] });
            } catch {
                console.log(`Cannot DM ${w.username}`);
            }
        });

        giveaway.winnersList = winners;
        endedGiveaways.set(messageId, giveaway);
    }

    activeGiveaways.delete(messageId);
}

// ---------- REGISTER COMMANDS ----------
client.on("ready", async () => {
    const data = [
        {
            name: "giveaway",
            description: "Start a giveaway",
            options: [
                { name: "duration", description: "Duration (e.g. 1h2m)", type: 3, required: true },
                { name: "winners", description: "Number of winners", type: 4, required: true },
                { name: "prize", description: "Prize", type: 3, required: true }
            ]
        },
        {
            name: "end",
            description: "Manually end a giveaway",
            options: [{ name: "message_id", description: "Giveaway message ID", type: 3, required: true }]
        },
        {
            name: "reroll",
            description: "Reroll winners for a giveaway",
            options: [{ name: "message_id", description: "Giveaway message ID", type: 3, required: true }]
        },
        { name: "giveaway_list", description: "Show active and ended giveaways" }
    ];
    await client.application.commands.set(data);
    console.log("✅ Slash commands registered!");
});

// ---------- RUN ----------
require("dotenv").config();
client.login(process.env.TOKEN);


const express = require('express')
const app = express()
const port = process.env.PORT || 4000

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})