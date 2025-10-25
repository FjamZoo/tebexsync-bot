import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel } from "discord.js";
import StaticMessage from "../classes/static_messages";
import Ticket from "../handlers/ticket_handler";
import env from "../utils/config";

export default new StaticMessage({
  name: 'TICKET-OPENER',
  customIds: ['open-ticket'],
  setup: async (logger, client) => {
    if (!env.TICKET_OPENER_CHANNEL_ID) {
      logger.warn('TICKET_OPENER_CHANNEL_ID not set in .env file. Skipping ticket opener setup.');
      return;
    }

    const channel = await client.channels.fetch(env.TICKET_OPENER_CHANNEL_ID) as TextChannel | null;

    if (!channel || !channel.isTextBased()) {
      logger.error('Channel not found or is not a text-based channel.');
      return;
    }

    const categories = await Ticket.getCategories();

    const embed = new EmbedBuilder()
      .setTitle('📌 Tickets')
      .setDescription('Select the type of ticket to open.')
      .setColor(0x00AEFF);

    const stringOptions = categories.length
      ? categories.map(({ id, name, description }) => {
          const option = new StringSelectMenuOptionBuilder()
            .setLabel(name)
            .setValue(id.toString())
            .setDefault(false);

          if (description) {
            option.setDescription(description)
          }

          return option;
        })
      : [
          new StringSelectMenuOptionBuilder()
            .setLabel('No available categories')
            .setDescription('Tell the server owners to configure it.')
            .setValue('-1')
            .setDefault(true)
        ];

    const button = new StringSelectMenuBuilder()
      .setCustomId('open-ticket')
      .setOptions(...stringOptions);

    const row = new ActionRowBuilder()
      .addComponents(button) as ActionRowBuilder<ButtonBuilder>;

    const messages = await channel.messages.fetch({ limit: 10, cache: false });

    const clientId = client.user!.id;

    const clientMessages = messages.filter(msg => msg.author.id === clientId).values();
    const lastMessage = clientMessages.next().value;

    if (!lastMessage) {
      await channel.send({ embeds: [embed], components: [row] });
    } else {
      await lastMessage.edit({ embeds: [embed], components: [row] });
    }

    logger.info('Static message setup complete.');
  },
  callback: async (logger, client, interaction) => {
    if (!interaction.isStringSelectMenu()) return;

    const category = parseInt(interaction.values[0]);

    if (isNaN(category)) {
      await interaction.reply({ content: 'Invalid selection', flags: MessageFlags.Ephemeral });
      return;
    }

    Ticket.createNewTicket(client, interaction, category);
  }
});
