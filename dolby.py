import discord
from discord.ext import commands
import asyncio
import random
import re
import os

# ---------- CONFIG ----------
TOKEN = os.getenv("DISCORD_TOKEN")  # Bot token from environment variable
INTENTS = discord.Intents.default()
INTENTS.message_content = True
INTENTS.members = True
bot = commands.Bot(command_prefix="!", intents=INTENTS)  # prefix not used

# Giveaway storage
active_giveaways = {}
ended_giveaways = {}

# ---------- TIME PARSER ----------
def parse_time(time_str: str):
    pattern = r'((?P<hours>\d+)h)?((?P<minutes>\d+)m)?((?P<seconds>\d+)s)?'
    match = re.match(pattern, time_str)
    if not match:
        return None
    time_data = {key: int(val) if val else 0 for key, val in match.groupdict().items()}
    return time_data["hours"] * 3600 + time_data["minutes"] * 60 + time_data["seconds"]

# ---------- EVENTS ----------
@bot.event
async def on_ready():
    await bot.tree.sync()
    print(f"✅ Logged in as {bot.user} (Slash commands synced)")

# ---------- SLASH COMMANDS ----------
@bot.tree.command(name="giveaway", description="Start a giveaway")
async def giveaway(interaction: discord.Interaction, duration: str, winners: int, prize: str):
    """Start a giveaway → /giveaway <duration> <winners> <prize>"""
    seconds = parse_time(duration)
    if not seconds:
        return await interaction.response.send_message("⚠️ Invalid time format! Use like `1h2m10s`.", ephemeral=True)

    embed = discord.Embed(title="🎉 Giveaway 🎉", description=f"**Prize:** {prize}", color=0x00ff00)
    embed.add_field(name="Hosted by", value=interaction.user.mention)
    embed.add_field(name="Duration", value=duration)
    embed.add_field(name="Number of winners", value=winners)
    message = await interaction.channel.send(embed=embed)
    await message.add_reaction("🎉")

    active_giveaways[message.id] = {
        "prize": prize,
        "winners": winners,
        "host": interaction.user,
        "message": message,
        "channel": interaction.channel
    }

    await interaction.response.send_message(f"✅ Giveaway started for **{prize}** (ID: `{message.id}`)", ephemeral=True)

    # Auto-end
    await asyncio.sleep(seconds)
    if message.id in active_giveaways:
        await end_giveaway(interaction, message.id, auto=True)

@bot.tree.command(name="end", description="Manually end a giveaway")
async def end(interaction: discord.Interaction, message_id: str):
    await end_giveaway(interaction, int(message_id), auto=False)

async def end_giveaway(interaction, message_id: int, auto=False):
    giveaway = active_giveaways.get(message_id)
    if not giveaway:
        return await interaction.channel.send("⚠️ Giveaway not found or already ended!")

    cache_msg = await giveaway["channel"].fetch_message(message_id)
    users = [user async for user in cache_msg.reactions[0].users() if not user.bot]

    winners = []
    if users:
        winners = random.sample(users, min(len(users), giveaway["winners"]))
        win_mentions = ", ".join(w.mention for w in winners)
        await giveaway["channel"].send(f"🎉 Congratulations {win_mentions}! You won **{giveaway['prize']}** 🎁")

        # Send DM embed to each winner
        for w in winners:
            try:
                embed = discord.Embed(
                    title="🏆 YOU WON THE GIVEAWAY! 🏆",
                    description=f"🎁 Prize: **{giveaway['prize']}**\n\n✨ Congratulations, enjoy your reward!",
                    color=0xFFD700  # Gold color
                )
                embed.set_footer(text=f"Hosted by: {giveaway['host'].display_name}")
                await w.send(embed=embed)
            except discord.Forbidden:
                print(f"Cannot DM {w.name}, they might have DMs disabled.")
    else:
        await giveaway["channel"].send("😢 No one joined the giveaway.")

    # Move giveaway to ended list
    ended_giveaways[message_id] = giveaway
    ended_giveaways[message_id]["winners_list"] = winners
    del active_giveaways[message_id]

@bot.tree.command(name="reroll", description="Reroll winners for a giveaway")
async def reroll(interaction: discord.Interaction, message_id: str):
    giveaway = ended_giveaways.get(int(message_id))
    if not giveaway:
        return await interaction.response.send_message("⚠️ Giveaway not found or not ended yet!", ephemeral=True)

    cache_msg = await giveaway["channel"].fetch_message(int(message_id))
    users = [user async for user in cache_msg.reactions[0].users() if not user.bot]

    if not users:
        return await interaction.response.send_message("😢 No participants found to reroll.", ephemeral=True)

    winners = random.sample(users, min(len(users), giveaway["winners"]))
    win_mentions = ", ".join(w.mention for w in winners)
    await giveaway["channel"].send(
        f"🔄 Reroll result: {win_mentions} won **{giveaway['prize']}** 🎁"
    )

    # DM winners with embed banner
    for w in winners:
        try:
            embed = discord.Embed(
                title="🏆 YOU WON THE GIVEAWAY (REROLL)! 🏆",
                description=(
                    f"🎁 Prize: **{giveaway['prize']}**\n\n"
                    "✨ Congratulations, enjoy your reward!"
                ),
                color=0xFFD700  # Gold color
            )
            embed.set_footer(text=f"Hosted by: {user.name}")  # Host username
            await w.send(embed=embed)
        except discord.Forbidden:
            print(f"Cannot DM {w.name}, they might have DMs disabled.")

    giveaway["winners_list"] = winners

@bot.tree.command(name="giveaway_list", description="Show active and inactive giveaways")
async def giveaway_list(interaction: discord.Interaction):
    embed = discord.Embed(title="📋 Giveaway List", color=0x3498db)

    if active_giveaways:
        active_text = "\n".join(
            [f"🟢 ID: `{gid}` | Prize: **{g['prize']}** | Winners: {g['winners']}" for gid, g in active_giveaways.items()]
        )
    else:
        active_text = "None"

    if ended_giveaways:
        ended_text = "\n".join(
            [f"🔴 ID: `{gid}` | Prize: **{g['prize']}** | Winners: {', '.join([w.mention for w in g.get('winners_list', [])]) or 'None'}"
             for gid, g in ended_giveaways.items()]
        )
    else:
        ended_text = "None"

    embed.add_field(name="Active Giveaways", value=active_text, inline=False)
    embed.add_field(name="Ended Giveaways", value=ended_text, inline=False)
    await interaction.response.send_message(embed=embed, ephemeral=True)

# Example command to test DM
@bot.command()
async def send_giveaway_dm(user: discord.User, giveaway_name: str, owner_name: str):
    """Send a styled giveaway DM to the user"""
    embed = discord.Embed(
        title="🎉 Entry Approved! 🎉",
        description=f"Your entry to **{giveaway_name}** has been approved!\nYou have a chance to win!!",
        color=0x1ABC9C
    )
    embed.set_footer(text=f"Hosted by: {user.name}")

    try:
        await user.send(embed=embed)
        print(f"Sent giveaway DM to {user.name}")
    except discord.Forbidden:
        print(f"Cannot send DM to {user.name}, they might have DMs disabled.")

# ----- Track Reaction Joins -----
@bot.event
async def on_reaction_add(reaction, user):
    if user.bot:
        return
    if reaction.emoji == "🎉":
        await send_giveaway_dm(user, reaction.message.embeds[0].title, reaction.message.embeds[0].fields[0].value)

# ---------- RUN ----------
if __name__ == "__main__":
    if not TOKEN:
        print("❌ Error: DISCORD_TOKEN environment variable not set!")
        print("Please set your Discord bot token as an environment variable.")
        exit(1)
    
    print("🚀 Starting Discord bot...")
    bot.run(TOKEN)


