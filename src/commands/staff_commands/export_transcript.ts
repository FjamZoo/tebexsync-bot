import { AttachmentBuilder, MessageFlags, PermissionsBitField, SlashCommandBuilder, TextChannel } from "discord.js";
import SlashCommand from "../../classes/slash_command";
import { generateTicketTranscript } from "../../utils/transcript_generator";
import Ticket from "../../handlers/ticket_handler";
import env from "../../utils/config";

export default new SlashCommand({
  name: 'export-transcript',
  guildSpecific: true,
  slashcommand: new SlashCommandBuilder()
    .setName('export-transcript')
    .setDescription('Export the current ticket as an HTML transcript')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers),
  callback: async (logger, client, interaction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = Ticket.getTicket(interaction.channelId);

    if (!ticket) {
      await interaction.editReply({
        content: 'This command can only be used in an active ticket channel.',
      });
      return;
    }

    try {
      logger.info(`Generating transcript for ticket ${ticket.ticketId}`);
      const html = await generateTicketTranscript(ticket.ticketId);

      const buffer = Buffer.from(html, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, {
        name: `ticket-${ticket.ticketId}-transcript.html`,
        description: `Transcript for ticket #${ticket.ticketId}`
      });

      await interaction.editReply({
        content: `✅ Transcript generated successfully! Download the HTML file and open it in your browser to view.`,
        files: [attachment],
      });

      // Optionally send to transcript channel if configured
      if (env.TRANSCRIPT_CHANNEL_ID) {
        try {
          const transcriptChannel = await client.channels.fetch(env.TRANSCRIPT_CHANNEL_ID) as TextChannel | null;

          if (transcriptChannel && transcriptChannel.isTextBased()) {
            await transcriptChannel.send({
              content: `📋 Transcript for Ticket #${ticket.ticketId} - **${ticket.channel.name}**`,
              files: [attachment],
            });
            logger.info(`Transcript also sent to transcript channel for ticket ${ticket.ticketId}`);
          }
        } catch (err) {
          logger.warn(`Failed to send transcript to channel:`, (err as Error).message);
        }
      }

      logger.success(`Transcript exported for ticket ${ticket.ticketId}`);
    } catch (err) {
      logger.error(`Failed to export transcript:`, (err as Error).message);

      await interaction.editReply({
        content: `❌ Failed to generate transcript: ${(err as Error).message}`,
      });
    }
  }
});
