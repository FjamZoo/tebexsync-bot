import {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import SlashCommand from "../../classes/slash_command";
import { prisma } from "../../utils/prisma";

export default new SlashCommand({
  name: "ticket-field",
  guildSpecific: true,
  slashcommand: new SlashCommandBuilder()
    .setName("ticket-field")
    .setDescription("Manage ticket category form fields")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName("add")
        .setDescription("Add a field to a ticket category")
        .addStringOption(o =>
          o
            .setName("category")
            .setDescription("The category to add the field to")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(o =>
          o
            .setName("label")
            .setDescription("The label/question for this field (e.g., 'What went wrong?')")
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o
            .setName("required")
            .setDescription("Whether this field is required")
            .setRequired(true)
        )
        .addBooleanOption(o =>
          o
            .setName("short")
            .setDescription("Use a short text input (single line) instead of long (paragraph)")
            .setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName("placeholder")
            .setDescription("Placeholder text for the field")
            .setRequired(false)
        )
        .addIntegerOption(o =>
          o
            .setName("min-length")
            .setDescription("Minimum length for the field")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(4000)
        )
        .addIntegerOption(o =>
          o
            .setName("max-length")
            .setDescription("Maximum length for the field")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(4000)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("list")
        .setDescription("List all fields for a ticket category")
        .addStringOption(o =>
          o
            .setName("category")
            .setDescription("The category to list fields for")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("remove")
        .setDescription("Remove a field from a ticket category")
        .addStringOption(o =>
          o
            .setName("category")
            .setDescription("The category to remove the field from")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(o =>
          o
            .setName("field-id")
            .setDescription("The ID of the field to remove")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),
  callback: async (logger, client, interaction) => {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "add") {
      const categoryName = interaction.options.getString("category", true);
      const label = interaction.options.getString("label", true);
      const required = interaction.options.getBoolean("required", true);
      const shortField = interaction.options.getBoolean("short", true);
      const placeholder = interaction.options.getString("placeholder") || "";
      const minLength = interaction.options.getInteger("min-length");
      const maxLength = interaction.options.getInteger("max-length");

      try {
        const category = await prisma.ticketCategories.findUnique({
          where: { name: categoryName }
        });

        if (!category) {
          await interaction.reply({
            content: `❌ No ticket category found with the name \`${categoryName}\`.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const field = await prisma.ticketCategoryFields.create({
          data: {
            category: category.id,
            label,
            placeholder,
            required: required ? 1 : 0,
            shortField: shortField ? 1 : 0,
            minLength,
            maxLength,
          }
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle("✅ Field Added")
          .setDescription(`Successfully added field to **${categoryName}**`)
          .addFields(
            { name: "Field ID", value: `${field.id}`, inline: true },
            { name: "Label", value: label, inline: true },
            { name: "Required", value: required ? "Yes" : "No", inline: true },
            { name: "Type", value: shortField ? "Short (single line)" : "Long (paragraph)", inline: true }
          );

        if (placeholder) {
          embed.addFields({ name: "Placeholder", value: placeholder });
        }
        if (minLength || maxLength) {
          const constraints = [];
          if (minLength) constraints.push(`Min: ${minLength}`);
          if (maxLength) constraints.push(`Max: ${maxLength}`);
          embed.addFields({ name: "Length Constraints", value: constraints.join(', ') });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        logger.success(`Added field to category ${categoryName}: ${label} (ID: ${field.id})`);

      } catch (err) {
        logger.error(`Failed to add field:`, (err as Error).message);
        await interaction.reply({
          content: `❌ Failed to add field: ${(err as Error).message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
    else if (subcommand === "list") {
      const categoryName = interaction.options.getString("category", true);

      try {
        const category = await prisma.ticketCategories.findUnique({
          where: { name: categoryName },
          include: {
            fields: {
              orderBy: { id: 'asc' }
            }
          }
        });

        if (!category) {
          await interaction.reply({
            content: `❌ No ticket category found with the name \`${categoryName}\`.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        if (category.fields.length === 0) {
          await interaction.reply({
            content: `No fields found for category \`${categoryName}\`.\n\nUse \`/ticket-field add\` to create form fields that users will fill out when opening a ticket.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`📝 Fields for ${categoryName}`)
          .setDescription(`Total fields: ${category.fields.length}\n\nThese are the form questions users answer when opening a ticket.`);

        for (const field of category.fields) {
          const constraints = [];
          if (field.minLength) constraints.push(`Min: ${field.minLength}`);
          if (field.maxLength) constraints.push(`Max: ${field.maxLength}`);
          const constraintStr = constraints.length > 0 ? ` (${constraints.join(', ')})` : '';

          embed.addFields({
            name: `ID ${field.id}: ${field.label}`,
            value: `**Type:** ${field.shortField ? 'Short (single line)' : 'Long (paragraph)'} | ` +
                   `**Required:** ${field.required ? 'Yes' : 'No'}${constraintStr}\n` +
                   (field.placeholder ? `*Placeholder: "${field.placeholder}"*` : ''),
            inline: false
          });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

      } catch (err) {
        logger.error(`Failed to list fields:`, (err as Error).message);
        await interaction.reply({
          content: `❌ Failed to list fields: ${(err as Error).message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
    else if (subcommand === "remove") {
      const categoryName = interaction.options.getString("category", true);
      const fieldId = interaction.options.getInteger("field-id", true);

      try {
        const category = await prisma.ticketCategories.findUnique({
          where: { name: categoryName }
        });

        if (!category) {
          await interaction.reply({
            content: `❌ No ticket category found with the name \`${categoryName}\`.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const field = await prisma.ticketCategoryFields.findFirst({
          where: {
            id: fieldId,
            category: category.id
          }
        });

        if (!field) {
          await interaction.reply({
            content: `❌ No field found with ID \`${fieldId}\` in category \`${categoryName}\`.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await prisma.ticketCategoryFields.delete({
          where: { id: fieldId }
        });

        await interaction.reply({
          content: `✅ Successfully removed field \`${field.label}\` (ID: ${fieldId}) from category \`${categoryName}\`.`,
          flags: MessageFlags.Ephemeral
        });
        logger.success(`Removed field ${fieldId} from category ${categoryName}`);

      } catch (err) {
        logger.error(`Failed to remove field:`, (err as Error).message);
        await interaction.reply({
          content: `❌ Failed to remove field: ${(err as Error).message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
  },
  autocomplete: async (logger, client, interaction) => {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === "category") {
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
    else if (focusedOption.name === "field-id") {
      try {
        const categoryName = interaction.options.getString("category");

        if (!categoryName) {
          await interaction.respond([]);
          return;
        }

        const category = await prisma.ticketCategories.findUnique({
          where: { name: categoryName },
          include: {
            fields: {
              orderBy: { id: 'asc' }
            }
          }
        });

        if (!category) {
          await interaction.respond([]);
          return;
        }

        const filtered = category.fields
          .filter(field =>
            field.id.toString().includes(focusedOption.value.toString()) ||
            field.label.toLowerCase().includes(focusedOption.value.toLowerCase())
          )
          .slice(0, 25);

        await interaction.respond(
          filtered.map(field => ({
            name: `${field.id}: ${field.label}`,
            value: field.id
          }))
        );
      } catch (err) {
        logger.error(`Autocomplete error:`, (err as Error).message);
        await interaction.respond([]);
      }
    }
  }
});
