import {
  CategoryChannel,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import SlashCommand from "../../classes/slash_command";
import { prisma } from "../../utils/prisma";

export default new SlashCommand({
  name: "ticket-category",
  guildSpecific: true,
  slashcommand: new SlashCommandBuilder()
    .setName("ticket-category")
    .setDescription("Manage ticket categories")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName("add")
        .setDescription("Create a new ticket category")
        .addStringOption(o =>
          o
            .setName("name")
            .setDescription("The name of the ticket category")
            .setRequired(true)
        )
        .addChannelOption(o =>
          o
            .setName("discord-category")
            .setDescription("The Discord category channel where tickets will be created")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o
            .setName("require-transaction")
            .setDescription("Require a valid Tebex transaction ID to open this ticket type")
            .setRequired(false)
        )
        .addStringOption(o =>
          o
            .setName("description")
            .setDescription("A brief description of this ticket category")
            .setRequired(false)
        )
        .addStringOption(o =>
          o
            .setName("emoji")
            .setDescription("An emoji to display for this category")
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("list")
        .setDescription("List all ticket categories")
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("delete")
        .setDescription("Delete a ticket category")
        .addStringOption(o =>
          o
            .setName("name")
            .setDescription("The name of the category to delete")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("update")
        .setDescription("Update a ticket category")
        .addStringOption(o =>
          o
            .setName("name")
            .setDescription("The name of the category to update")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addChannelOption(o =>
          o
            .setName("discord-category")
            .setDescription("The Discord category channel where tickets will be created")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
        .addBooleanOption(o =>
          o
            .setName("require-transaction")
            .setDescription("Require a valid Tebex transaction ID to open this ticket type")
            .setRequired(false)
        )
        .addStringOption(o =>
          o
            .setName("description")
            .setDescription("A brief description of this ticket category")
            .setRequired(false)
        )
        .addStringOption(o =>
          o
            .setName("emoji")
            .setDescription("An emoji to display for this category")
            .setRequired(false)
        )
    ),
  callback: async (logger, client, interaction) => {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "add") {
      const name = interaction.options.getString("name", true);
      const discordCategory = interaction.options.getChannel("discord-category", true) as CategoryChannel;
      const requireTransaction = interaction.options.getBoolean("require-transaction") ?? true;
      const description = interaction.options.getString("description");
      const emoji = interaction.options.getString("emoji");

      try {
        // Check if category name already exists
        const existingName = await prisma.ticketCategories.findUnique({
          where: { name }
        });

        if (existingName) {
          await interaction.reply({
            content: `❌ A ticket category with the name \`${name}\` already exists.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        // Create the category
        const category = await prisma.ticketCategories.create({
          data: {
            name,
            description,
            emoji,
            categoryId: discordCategory.id,
            requireTbxId: requireTransaction ? 1 : 0,
          }
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle("✅ Ticket Category Created")
          .setDescription(`Successfully created ticket category **${name}**`)
          .addFields(
            { name: "ID", value: `${category.id}`, inline: true },
            { name: "Discord Category", value: `<#${discordCategory.id}>`, inline: true },
            { name: "Requires Transaction", value: requireTransaction ? "Yes" : "No", inline: true }
          );

        if (description) {
          embed.addFields({ name: "Description", value: description });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        logger.success(`Created ticket category: ${name} (ID: ${category.id})`);

      } catch (err) {
        logger.error(`Failed to create ticket category:`, (err as Error).message);
        await interaction.reply({
          content: `❌ Failed to create ticket category: ${(err as Error).message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
    else if (subcommand === "list") {
      try {
        const categories = await prisma.ticketCategories.findMany({
          include: {
            _count: {
              select: { fields: true, tickets: true }
            }
          }
        });

        if (categories.length === 0) {
          await interaction.reply({
            content: "No ticket categories found.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("📋 Ticket Categories")
          .setDescription(`Total categories: ${categories.length}`);

        for (const cat of categories) {
          const emoji = cat.emoji || "🎫";
          const desc = cat.description || "*No description*";
          const fieldCount = cat._count.fields;
          const ticketCount = cat._count.tickets;

          embed.addFields({
            name: `${emoji} ${cat.name} (ID: ${cat.id})`,
            value: `${desc}\n` +
                   `**Category:** <#${cat.categoryId}>\n` +
                   `**Requires Transaction:** ${cat.requireTbxId ? 'Yes' : 'No'}\n` +
                   `**Fields:** ${fieldCount} | **Tickets:** ${ticketCount}`,
            inline: false
          });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

      } catch (err) {
        logger.error(`Failed to list ticket categories:`, (err as Error).message);
        await interaction.reply({
          content: `❌ Failed to list ticket categories: ${(err as Error).message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
    else if (subcommand === "delete") {
      const name = interaction.options.getString("name", true);

      try {
        const category = await prisma.ticketCategories.findUnique({
          where: { name },
          include: {
            _count: {
              select: { tickets: true }
            }
          }
        });

        if (!category) {
          await interaction.reply({
            content: `❌ No ticket category found with the name \`${name}\`.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        if (category._count.tickets > 0) {
          await interaction.reply({
            content: `❌ Cannot delete category \`${name}\` because it has ${category._count.tickets} ticket(s) associated with it.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await prisma.ticketCategories.delete({
          where: { name }
        });

        await interaction.reply({
          content: `✅ Successfully deleted ticket category \`${name}\`.`,
          flags: MessageFlags.Ephemeral
        });
        logger.success(`Deleted ticket category: ${name}`);

      } catch (err) {
        logger.error(`Failed to delete ticket category:`, (err as Error).message);
        await interaction.reply({
          content: `❌ Failed to delete ticket category: ${(err as Error).message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
    else if (subcommand === "update") {
      const name = interaction.options.getString("name", true);
      const discordCategory = interaction.options.getChannel("discord-category") as CategoryChannel | null;
      const requireTransaction = interaction.options.getBoolean("require-transaction");
      const description = interaction.options.getString("description");
      const emoji = interaction.options.getString("emoji");

      try {
        const category = await prisma.ticketCategories.findUnique({
          where: { name }
        });

        if (!category) {
          await interaction.reply({
            content: `❌ No ticket category found with the name \`${name}\`.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const updateData: any = {};
        if (discordCategory) updateData.categoryId = discordCategory.id;
        if (requireTransaction !== null) updateData.requireTbxId = requireTransaction ? 1 : 0;
        if (description !== null) updateData.description = description;
        if (emoji !== null) updateData.emoji = emoji;

        if (Object.keys(updateData).length === 0) {
          await interaction.reply({
            content: "❌ No updates provided. Please specify at least one field to update.",
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await prisma.ticketCategories.update({
          where: { name },
          data: updateData
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle("✅ Ticket Category Updated")
          .setDescription(`Successfully updated ticket category **${name}**`)
          .addFields(
            Object.keys(updateData).map(key => ({
              name: key,
              value: `${updateData[key]}`,
              inline: true
            }))
          );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        logger.success(`Updated ticket category: ${name}`);

      } catch (err) {
        logger.error(`Failed to update ticket category:`, (err as Error).message);
        await interaction.reply({
          content: `❌ Failed to update ticket category: ${(err as Error).message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
  },
  autocomplete: async (logger, client, interaction) => {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === "name") {
      try {
        const categories = await prisma.ticketCategories.findMany({
          select: { name: true }
        });

        const filtered = categories
          .filter(cat =>
            cat.name.toLowerCase().includes(focusedOption.value.toLowerCase())
          )
          .slice(0, 25);

        await interaction.respond(
          filtered.map(cat => ({ name: cat.name, value: cat.name }))
        );
      } catch (err) {
        logger.error(`Autocomplete error:`, (err as Error).message);
        await interaction.respond([]);
      }
    }
  }
});
