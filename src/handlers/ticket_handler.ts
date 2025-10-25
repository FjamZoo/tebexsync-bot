import { DiscordClient, TebexAPIError, TebexPayment, TicketCategory, TicketCategoryData } from "@types";
import {
  ActionRowBuilder,
  APIEmbedField,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CategoryChannel,
  ChannelType,
  ChatInputCommandInteraction,
  CommandInteraction,
  EmbedBuilder,
  Message,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  User,
} from "discord.js";
import Tebex from "./tebex_handler";
import Logger from "../utils/logger";
import env from "../utils/config";
import { FormatDateForDB, tbxIdRegex } from "../utils/utils";
import { prisma } from "../utils/prisma";

const logger = new Logger('ticket-handler');

class Ticket {
  private static ActiveTickets: Map<string, Ticket> = new Map();

  static async reloadTickets(client: DiscordClient) {
    const applicationUser = client.user!;
    const tickets = await prisma.tickets.findMany({
      where: {
        closedAt: null,
      }
    });

    for (let idx = 0; idx < tickets.length; idx++) {
      const ticketData = tickets[idx];

      try {
        const channel = await client.channels.fetch(ticketData.channelId) as TextChannel | null;

        if (!channel) throw new Error('No channel was found.')

        const ticket = new Ticket(channel, ticketData.id);
        this.ActiveTickets.set(channel.id, ticket);
      } catch (err) {
        logger.warn(`Ticket ${ticketData.id} was closed manually (${(err as Error).message}), closing in database.`);

        const date = FormatDateForDB();
        await prisma.tickets.update({
          where: {
            id: ticketData.id,
          },
          data: {
            closedAt: date,
          }
        });

        const closureEmbed = new EmbedBuilder()
          .setTitle('Ticket closed');

        await prisma.ticketMessages.create({
          data: {
            ticket: ticketData.id,
            authorId: applicationUser.id,
            displayName: applicationUser.displayName,
            avatar: applicationUser.avatarURL({ forceStatic: true, extension: 'webp', size: 128 }),
            content: `<EMBED:${JSON.stringify(closureEmbed.toJSON())}>`,
          }
        });
      }
    }

    logger.success(`Reloaded ${this.ActiveTickets.size} tickets from database`);
  }

  static async getCategories(): Promise<TicketCategory[]> {
    const categories = await prisma.ticketCategories.findMany();
    return categories;
  }

  static async getCategoryData({ id, name }: { id?: number | null; name?: string | null }): Promise<TicketCategoryData | null> {
    if (id === null && name === null) {
      throw new Error('No id or name was specified!');
    }

    const categoryData = await prisma.ticketCategories.findUnique({
      where: {
        id: id ?? undefined,
        name: name ?? undefined,
      },
      include: {
        fields: true,
      },
    });

    return categoryData as TicketCategoryData | null;
  }

  static async createNewTicket(
    client: DiscordClient,
    interaction: ButtonInteraction | CommandInteraction | StringSelectMenuInteraction,
    category_id: number
  ) {
    const categoryData = await this.getCategoryData({ id: category_id});

    if (!categoryData) {
      return interaction.reply({
        content: 'Invalid Data',
        flags: MessageFlags.Ephemeral,
      });
    }

    const { user } = interaction;
    const guild = await client.guilds.fetch(env.MAIN_GUILD_ID);

    if (!guild) throw new Error(`No guild was found ! Make sure the environment variable MAIN_GUILD_ID is set to a valid guild ID !`);

    // If no fields and no transaction required, create ticket directly without modal
    if (!categoryData.requireTbxId && categoryData.fields.length === 0) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const categoryChannel = await client.channels.fetch(categoryData.categoryId) as CategoryChannel | null;

      if (!categoryChannel) {
        logger.error(`Unable to find category channel (${categoryData.categoryId}) for category: ${categoryData.name} !`);

        await interaction.editReply({
          content: `Unable to open a ticket, please inform the developers that no category was found.`
        });

        return;
      }

      // Clone category permissions and add the ticket creator
      const permissionOverwrites = categoryChannel.permissionOverwrites.cache.map(overwrite => ({
        id: overwrite.id,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
        type: overwrite.type
      }));

      // Add the user who opened the ticket
      permissionOverwrites.push({
        id: user.id,
        allow: PermissionFlagsBits.ViewChannel,
        deny: 0n,
        type: 1 // 1 = Member
      });

      const channel = await guild.channels.create({
        name: user.username,
        parent: categoryChannel,
        reason: `Ticket opened by ${user.username} under category: ${categoryData.name}`,
        type: ChannelType.GuildText,
        permissionOverwrites: permissionOverwrites,
      });

      await interaction.editReply({
        content: `Your ticket has been opened: ${channel.url}.`
      });

      const embed = new EmbedBuilder()
        .setTitle(`${categoryData.name} ticket - ${user.displayName}`)
        .setDescription("> :warning: Failure to follow ticket guidelines and required information **can** lead to the ticket getting closed.");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`close-ticket`)
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
      ) as ActionRowBuilder<ButtonBuilder>;

      const dbTicket = await prisma.tickets.create({
        data: {
          category: categoryData.id,
          ticketName: channel.name,
          channelId: channel.id,
          userId: user.id,
          userUsername: user.username,
          userDisplayName: user.displayName,
        }
      });

      if (!dbTicket) throw new Error('Unable to insert ticket data into database ! (unknown error)');

      const ticket = new Ticket(
        channel,
        dbTicket.id,
      );

      this.ActiveTickets.set(ticket.channel.id, ticket);

      const message = await channel.send({
        content: `<@${user.id}>`,
        embeds: [embed],
        components: [row],
      });

      // Create private staff thread
      if (env.STAFF_ROLE_IDS.length > 0) {
        try {
          const thread = await channel.threads.create({
            name: `Evidence-${dbTicket.id}`,
            autoArchiveDuration: 10080, // 7 days
            type: ChannelType.PrivateThread,
            reason: `Staff discussion thread for ticket #${dbTicket.id}`
          });

          // Save staff thread ID to database
          await prisma.tickets.update({
            where: { id: dbTicket.id },
            data: { staffThreadId: thread.id }
          });

          // Send initial message to mention all staff roles
          const staffMentions = env.STAFF_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' ');
          await thread.send({
            content: `${staffMentions}\n\n🔒 **Staff Evidence Thread**\nPrivate staff-only discussion for this ticket. A separate transcript will be generated for this thread and sent to the transcript channel when the ticket is closed.`
          });

          logger.info(`Created private staff thread for ticket ${dbTicket.id}`);
        } catch (err) {
          logger.warn(`Failed to create private staff thread for ticket ${dbTicket.id}:`, (err as Error).message);
        }
      }

      return;
    }

    const modalInteractionId = `collector-openticket-${categoryData.id}-${user.id}`;

    const modal = new ModalBuilder()
      .setCustomId(modalInteractionId)
      .setTitle(`Ticket: ${categoryData.name}`);

    if (categoryData.requireTbxId) {
      const textInput = new TextInputBuilder()
        .setCustomId(`tbxid`)
        .setLabel('Transaction ID')
        .setPlaceholder('tbx-000a0000a00000-aaa0aa')
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
        .setMinLength(25)
        .setMaxLength(40);

      const actionRow = new ActionRowBuilder<TextInputBuilder>()
        .addComponents(textInput);

      modal.addComponents(actionRow);
    }

    const fieldComponents = categoryData.fields.map((field) => {
      const textInput = new TextInputBuilder()
        .setCustomId(`${field.id}`)
        .setLabel(field.label)
        .setRequired(field.required === 1)
        .setStyle(field.short_field === 1 ? TextInputStyle.Short : TextInputStyle.Paragraph);

      if (field.placeholder) {
        textInput.setPlaceholder(field.placeholder);
      }
      if (field.min_length) {
        textInput.setMinLength(field.min_length);
      }
      if (field.max_length) {
        textInput.setMaxLength(field.max_length);
      }

      // Wrap the text input in an action row.
      return new ActionRowBuilder<TextInputBuilder>()
        .addComponents(textInput);
    });

    modal.addComponents(...fieldComponents);

    await interaction.showModal(modal);

    const filter = (modalInteraction: ModalSubmitInteraction) => (
          modalInteraction.customId === modalInteractionId
      &&  modalInteraction.user.id === interaction.user.id
    );

    let responseData, modalInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({ filter, time: 60_000 });

      responseData = modalInteraction.fields.fields;
    } catch {
      modalInteraction?.reply({
        content: `Ticket opening cancelled`,
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const formattedResponses = modal.components
      .filter(component => component instanceof ActionRowBuilder)
      .map(component => {
        const actionRow = component as ActionRowBuilder<TextInputBuilder>;
        const textInput = actionRow.components[0];
        const label = textInput.data.label as string;
        const id = textInput.data.custom_id as string;

        const fieldData = responseData.get(id)!;
        const response = 'value' in fieldData ? fieldData.value : '';

        return {
          label, response, id
        };
      })
      .filter((e) => !!(e.label && e.response && e.id));

    let purchase: { success: true; data: TebexPayment; } | TebexAPIError;
    if (categoryData.requireTbxId) {
      const tbxid = formattedResponses.find((item) => item.id === 'tbxid')?.response;

      if (!tbxid) {
        modalInteraction.editReply({
          content: `This ticket requires a **valid** transaction id for a purchase.`
        });
        return;
      }

      purchase = await Tebex.verifyPurchase(tbxid);

      if (!purchase.success) {
        modalInteraction.editReply({
          content: `This ticket requires a **valid** transaction id for a purchase.`
        });

        return;
      }
    }

    const categoryChannel = await client.channels.fetch(categoryData.categoryId) as CategoryChannel | null;

    if (!categoryChannel) {
      logger.error(`Unable to find category channel (${categoryData.categoryId}) for category: ${categoryData.name} !`);

      modalInteraction.editReply({
        content: `Unable to open a ticket, please inform the developers that no category was found.`
      });

      return;
    }

    // Clone category permissions and add the ticket creator
    const permissionOverwrites = categoryChannel.permissionOverwrites.cache.map(overwrite => ({
      id: overwrite.id,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
      type: overwrite.type
    }));

    // Add the user who opened the ticket
    permissionOverwrites.push({
      id: user.id,
      allow: PermissionFlagsBits.ViewChannel,
      deny: 0n,
      type: 1 // 1 = Member
    });

    const channel = await guild.channels.create({
      name: user.username,
      parent: categoryChannel,
      reason: `Ticket opened by ${user.username} under category: ${categoryData.name}`,
      type: ChannelType.GuildText,
      permissionOverwrites: permissionOverwrites,
    });


    modalInteraction.editReply({
      content: `Your ticket has been opened: ${channel.url}.`
    });

    const fields: APIEmbedField[] = formattedResponses.map(({ label, response }) => {
      let value = response, name = label;
      if (tbxIdRegex.test(response) && purchase.success) {
        name = 'Purchase Info';
        value = `* Transaction ID: ${response}\n`+
                `* Status: ${purchase.data.status}\n`+
                `* Packages: ${purchase.data.packages.map(e => e.name).join(', ')}`;
      }

      return {
        name,
        value,
        inline: false,
      }
    });

    const embed = new EmbedBuilder()
      .setTitle(`${categoryData.name} ticket - ${user.displayName}`)
      .setDescription("> :warning: Failure to follow ticket guidelines and required information **can** lead to the ticket getting closed.")
      .setFields(...fields);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`close-ticket`)
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    ) as ActionRowBuilder<ButtonBuilder>;

    const dbTicket = await prisma.tickets.create({
      data: {
        category: categoryData.id,
        ticketName: channel.name,
        channelId: channel.id,
        userId: user.id,
        userUsername: user.username,
        userDisplayName: user.displayName,
      }
    });

    if (!dbTicket) throw new Error('Unable to insert ticket data into database ! (unknown error)');

    const ticket = new Ticket(
      channel,
      dbTicket.id,
    );

    this.ActiveTickets.set(ticket.channel.id, ticket);

    const message = await channel.send({
      content: `<@${user.id}>`,
      embeds: [embed],
      components: [row],
    });

    // Create private staff thread
    if (env.STAFF_ROLE_IDS.length > 0) {
      try {
        const thread = await channel.threads.create({
          name: `Evidence-${dbTicket.id}`,
          autoArchiveDuration: 10080, // 7 days
          type: ChannelType.PrivateThread,
          reason: `Staff discussion thread for ticket #${dbTicket.id}`
        });

        // Save staff thread ID to database
        await prisma.tickets.update({
          where: { id: dbTicket.id },
          data: { staffThreadId: thread.id }
        });

        // Send initial message to mention all staff roles
        const staffMentions = env.STAFF_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(' ');
        await thread.send({
          content: `${staffMentions} - Private staff-only discussion for this ticket. Messages here will NOT be included in the transcript.`
        });

        logger.info(`Created private staff thread for ticket ${dbTicket.id}`);
      } catch (err) {
        logger.warn(`Failed to create private staff thread for ticket ${dbTicket.id}:`, (err as Error).message);
      }
    }
  }

  static async updateMessages(message: Message) {
    const { channelId } = message;

    const ticket = this.ActiveTickets.get(channelId);

    if (!ticket) return;

    ticket.handleNewMessage(message);
  }

  static getTicket(channelId: string) {
    return this.ActiveTickets.get(channelId) ?? null
  }

  static async closeTicket(channelId: string, interaction: ChatInputCommandInteraction | ButtonInteraction) {
    const ticket = this.getTicket(channelId);

    if (!ticket) {
      interaction.reply({
        content: `This channel is not an active ticket.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalInteractionId = `collector-closeticket-${channelId}`;

    const modal = new ModalBuilder()
      .setCustomId(modalInteractionId)
      .setTitle(`Closing ticket: ${ticket.channel.name}`);

    const textInput = new TextInputBuilder()
      .setCustomId(`closure-reason-${channelId}`)
      .setLabel('Closure reason:')
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    const actionRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(textInput);

    modal.addComponents(actionRow);

    await interaction.showModal(modal);

    const filter = (modalInteraction: ModalSubmitInteraction) => (
          modalInteraction.customId === modalInteractionId
      &&  modalInteraction.user.id === interaction.user.id
    );

    let closureReason, modalInteraction;
    try {
      modalInteraction = await interaction.awaitModalSubmit({ filter, time: 60_000 });

      closureReason = modalInteraction.fields.getTextInputValue(`closure-reason-${channelId}`);
    } catch (err) {
      logger.error((err as Error).message);

      modalInteraction?.reply({
        content: `Closure cancelled`,
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const success = await ticket.closeTicket(interaction.user, closureReason);

    if (success) {
      this.ActiveTickets.delete(channelId);
    }

    await modalInteraction.deleteReply();

    const dbUser = await prisma.tickets.findUnique({
      select: {
        userId: true,
      },
      where: {
        id: ticket.ticketId,
      }
    });

    if (!dbUser || dbUser.userId === modalInteraction.user.id) return;

    const closureEmbed = new EmbedBuilder()
      .setAuthor(modalInteraction.guild ? { name: modalInteraction.guild.name } : null)
      .setTitle('Your ticket closed')
      .setThumbnail(modalInteraction.guild?.iconURL({ size: 256, extension: 'webp' }) ?? null)
      .setDescription(
        closureReason
          ? `Closure reason:\n> ${closureReason}`
          : 'Ticket considered as resolved.'
      );

    try {
      const user = await modalInteraction.guild?.members.fetch(dbUser.userId);

      if (!user) throw new Error(`${dbUser.userId} was not found`);

      await user.send({
        embeds: [closureEmbed],
      })
    } catch (err) {
      logger.error(`Unable to send closure notification to user: ${(err as Error).message}`);
    }
  }

  ticketId: number;
  channel: TextChannel;

  constructor (
    channel: TextChannel,
    ticketId: number,
  ) {
    this.channel = channel;
    this.ticketId = ticketId;
  }

  async handleNewMessage(message: Message) {
    let content = message.content;

    if (message.embeds.length > 0) {
      const embeds = [];
      for (let idx = 0; idx < message.embeds.length; idx++) {
        embeds[idx] = `<EMBED:${JSON.stringify(message.embeds[idx].toJSON())}>\n`;
      }
      content += `${content.length > 0 ? '\n\n' : ''}${embeds.join('\n')}`;
    }

    const { author } = message;

    await prisma.ticketMessages.create({
      data: {
        ticket: this.ticketId,
        authorId: author.id,
        displayName: author.displayName,
        avatar: author.avatarURL({ forceStatic: true, extension: 'webp', size: 128 }),
        content: content,
      }
    });
  }

  async addTicketParticipant(addedUser: User, userWhoAddedTheOtherUserNiceVariableName: User) {
    try {
      await prisma.ticketMembers.upsert({
        where: {
          ticket_userId: {
            ticket: this.ticketId,
            userId: addedUser.id,
          },
        },
        update: {
          removed: 0,
          addedBy: userWhoAddedTheOtherUserNiceVariableName.id,
          addedAt: new Date(),
        },
        create: {
          ticket: this.ticketId,
          userId: addedUser.id,
          addedBy: userWhoAddedTheOtherUserNiceVariableName.id,
        },
      });

      await this.channel.permissionOverwrites.create(addedUser, {
        ViewChannel: true,
      });

      const embed = new EmbedBuilder()
        .setAuthor({
          name: userWhoAddedTheOtherUserNiceVariableName.username,
          iconURL: userWhoAddedTheOtherUserNiceVariableName.avatarURL({
            forceStatic: true,
            extension: 'webp',
            size: 128
          }) ?? undefined
        })
        .setTitle('New ticket participant')
        .setDescription(`<@${addedUser.id}> was added to the ticket`);

      this.channel.send({
        embeds: [embed]
      });

      return true;
    } catch (err) {
      logger.error(`Unable to add ${addedUser.id} to ticket (${this.ticketId} - ${this.channel.id}):`, (err as Error).message);
      return false;
    }
  }

  async removeTicketParticipant(userId: string, userDoingTheActionOfRemovingOtherUser: User) {
    try {
      await prisma.ticketMembers.update({
        where: {
          ticket_userId: {
            ticket: this.ticketId,
            userId: userId,
          },
        },
        data: {
          removed: 1,
        },
      });

      await this.channel.permissionOverwrites.delete(
        userId,
        `Removed from ticket by ${userDoingTheActionOfRemovingOtherUser.username} (${userDoingTheActionOfRemovingOtherUser.id})`
      );

      return true;
    } catch (err) {
      logger.error(`Unable to remove ${userId} from ticket (${this.ticketId} - ${this.channel.id}):`, (err as Error).message);
      return false;
    }
  }

  async closeTicket(user: User, reason: string | undefined) {
    logger.info(`Ticket ${this.ticketId} closed by ${user.username}, reason: ${reason ?? 'N/A'}`);

    try {
      // Get ticket info before closing
      const ticketInfo = await prisma.tickets.findUnique({
        where: { id: this.ticketId },
        include: {
          ticketCategory: true
        }
      });

      await prisma.tickets.update({
        where: {
          id: this.ticketId,
        },
        data: {
          closedAt: new Date(),
        },
      });

      const closureEmbed = new EmbedBuilder()
        .setTitle('Ticket closed')
        .setDescription(
          reason
            ? `Closure reason:\n> ${reason}`
            : 'No reason provided.'
        );

      await prisma.ticketMessages.create({
        data: {
          ticket: this.ticketId,
          authorId: user.id,
          displayName: user.displayName,
          avatar: user.avatarURL({ forceStatic: true, extension: 'webp', size: 128 }) ?? '',
          content: `<EMBED:${JSON.stringify(closureEmbed.toJSON())}>`,
        },
      });

      let transcriptHtml: string | null = null;
      let transcriptBuffer: Buffer | null = null;

      if (ticketInfo) {
        try {
          const { generateTicketTranscript } = await import('../utils/transcript_generator.js');
          transcriptHtml = await generateTicketTranscript(this.ticketId);
          transcriptBuffer = Buffer.from(transcriptHtml, 'utf-8');
        } catch (err) {
          logger.error(`Failed to generate transcript for ticket ${this.ticketId}:`, (err as Error).message);
        }
      }

      if (env.TRANSCRIPT_CHANNEL_ID && ticketInfo && transcriptBuffer) {
        try {
          const attachment = new AttachmentBuilder(transcriptBuffer, {
            name: `ticket-${this.ticketId}-transcript.html`,
            description: `Transcript for ticket #${this.ticketId}`
          });

          const client = this.channel.client as DiscordClient;
          const transcriptChannel = await client.channels.fetch(env.TRANSCRIPT_CHANNEL_ID) as TextChannel | null;

          if (transcriptChannel && transcriptChannel.isTextBased()) {
            const embed = new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle(`📋 Ticket #${this.ticketId} Closed`)
              .addFields(
                { name: 'Category', value: ticketInfo.ticketCategory.name, inline: true },
                { name: 'Channel', value: `#${this.channel.name}`, inline: true },
                { name: 'Closed By', value: `${user.displayName} (@${user.username})`, inline: true },
                { name: 'Owner', value: `${ticketInfo.userDisplayName} (@${ticketInfo.userUsername})`, inline: true }
              );

            if (reason) {
              embed.addFields({ name: 'Closure Reason', value: reason });
            }

            await transcriptChannel.send({
              embeds: [embed],
              files: [attachment],
            });

            logger.success(`Transcript sent to transcript channel for ticket ${this.ticketId}`);

            // Generate and send staff thread transcript if it exists
            if (ticketInfo.staffThreadId) {
              try {
                const staffThread = await client.channels.fetch(ticketInfo.staffThreadId);

                if (staffThread && staffThread.isThread()) {
                  const staffMessages = await staffThread.messages.fetch({ limit: 100 });

                  if (staffMessages.size > 1) { // More than just the initial message
                    const staffTranscriptHtml = this.generateStaffThreadHTML(
                      ticketInfo,
                      staffMessages.reverse().map(msg => ({
                        id: msg.id,
                        authorId: msg.author.id,
                        displayName: msg.author.displayName || msg.author.username,
                        avatar: msg.author.avatarURL({ forceStatic: true, extension: 'webp', size: 128 }),
                        content: msg.content,
                        editedAt: msg.editedAt,
                        sentAt: msg.createdAt
                      }))
                    );

                    const staffTranscriptBuffer = Buffer.from(staffTranscriptHtml, 'utf-8');
                    const staffAttachment = new AttachmentBuilder(staffTranscriptBuffer, {
                      name: `ticket-${this.ticketId}-staff-evidence.html`,
                      description: `Staff evidence transcript for ticket #${this.ticketId}`
                    });

                    const staffEmbed = new EmbedBuilder()
                      .setColor(0xED4245)
                      .setTitle(`🔒 Staff Evidence - Ticket #${this.ticketId}`)
                      .setDescription('**STAFF ONLY** - Internal discussion transcript')
                      .addFields(
                        { name: 'Category', value: ticketInfo.ticketCategory.name, inline: true },
                        { name: 'Channel', value: `#${this.channel.name}`, inline: true },
                        { name: 'Messages', value: `${staffMessages.size}`, inline: true }
                      );

                    await transcriptChannel.send({
                      embeds: [staffEmbed],
                      files: [staffAttachment],
                    });

                    logger.success(`Staff thread transcript sent to transcript channel for ticket ${this.ticketId}`);
                  }
                }
              } catch (err) {
                logger.warn(`Failed to send staff thread transcript for ticket ${this.ticketId}:`, (err as Error).message);
              }
            }
          }
        } catch (err) {
          logger.error(`Failed to send transcript to channel for ticket ${this.ticketId}:`, (err as Error).message);
        }
      }

      // Send DM to ticket owner with transcript
      if (ticketInfo && transcriptBuffer) {
        try {
          const client = this.channel.client as DiscordClient;
          const ticketOwner = await client.users.fetch(ticketInfo.userId);

          if (ticketOwner) {
            const dmEmbed = new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle('Your Ticket Was Closed')
              .setDescription(`Your ticket **#${this.channel.name}** in the **${ticketInfo.ticketCategory.name}** category has been closed.`)
              .addFields(
                { name: 'Closed By', value: `${user.displayName} (@${user.username})`, inline: true }
              );

            if (reason) {
              dmEmbed.addFields({ name: 'Reason', value: reason });
            }

            const attachment = new AttachmentBuilder(transcriptBuffer, {
              name: `ticket-${this.ticketId}-transcript.html`,
              description: `Transcript for your ticket`
            });

            await ticketOwner.send({
              embeds: [dmEmbed],
              files: [attachment],
            });

            logger.success(`Transcript DM sent to ticket owner ${ticketOwner.username} for ticket ${this.ticketId}`);
          }
        } catch (err) {
          logger.warn(`Failed to send transcript DM to ticket owner for ticket ${this.ticketId}:`, (err as Error).message);
        }
      }

      setTimeout(() => {
        this.channel.delete(`Ticket closed by ${user.username}${reason ? `: ${reason}` : ''}`)
          .catch((err: Error) => logger.error(`An error occurred (${err.message}) when deleting the ticket ${this.ticketId} channel ${this.channel.id}`));
      }, 500);

      return true;
    } catch (err) {
      logger.error(`Unable to close ticket ${this.ticketId}:`, (err as Error).message);
      return false;
    }
  }

  private generateStaffThreadHTML(ticketInfo: any, messages: any[]): string {
    const formatTimestamp = (date: Date): string => {
      const messageDate = new Date(date);
      const dateString = messageDate.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
      });
      const timeString = messageDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      return `${dateString} ${timeString}`;
    };

    const escapeHtml = (text: string): string => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, (m) => map[m]);
    };

    const messagesHTML = messages.map((msg) => {
      const avatar = msg.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
      const timestamp = formatTimestamp(msg.sentAt);
      const editedText = msg.editedAt ? ` <span class="edited">(edited)</span>` : '';
      const content = msg.content ? escapeHtml(msg.content).replace(/\n/g, '<br>') : '';

      return `
        <div class="message">
          <img src="${avatar}" alt="${escapeHtml(msg.displayName)}" class="avatar">
          <div class="message-body">
            <div class="message-header">
              <span class="username">${escapeHtml(msg.displayName)}</span>
              <span class="timestamp">${timestamp}${editedText}</span>
            </div>
            <div class="message-content">${content}</div>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Staff Evidence - Ticket ${this.ticketId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #36393f; color: #dcddde; line-height: 1.375; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background-color: #2f3136; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #ED4245; }
    .header h1 { font-size: 24px; margin-bottom: 10px; color: #ffffff; }
    .header-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 15px; font-size: 14px; }
    .header-info-item { background-color: #202225; padding: 8px 12px; border-radius: 4px; }
    .header-info-label { color: #b9bbbe; font-weight: 600; margin-right: 5px; }
    .messages { background-color: #2f3136; padding: 20px; border-radius: 8px; }
    .message { display: flex; padding: 10px 0; position: relative; }
    .message:hover { background-color: #32353b; margin: 0 -20px; padding-left: 20px; padding-right: 20px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; flex-shrink: 0; }
    .message-body { flex: 1; min-width: 0; }
    .message-header { display: flex; align-items: baseline; margin-bottom: 4px; }
    .username { font-weight: 500; color: #ffffff; margin-right: 8px; }
    .timestamp { font-size: 12px; color: #72767d; font-weight: 400; }
    .edited { font-size: 10px; color: #72767d; }
    .message-content { color: #dcddde; word-wrap: break-word; font-size: 16px; line-height: 1.375; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔒 Staff Evidence - Ticket #${this.ticketId}</h1>
      <div class="header-info">
        <div class="header-info-item">
          <span class="header-info-label">Category:</span>
          <span>${escapeHtml(ticketInfo.ticketCategory.name)}</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Ticket:</span>
          <span>#${escapeHtml(ticketInfo.ticketName)}</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Owner:</span>
          <span>${escapeHtml(ticketInfo.userDisplayName)} (@${escapeHtml(ticketInfo.userUsername)})</span>
        </div>
        <div class="header-info-item">
          <span class="header-info-label">Total Messages:</span>
          <span>${messages.length}</span>
        </div>
      </div>
    </div>
    <div class="messages">
      ${messagesHTML}
    </div>
  </div>
</body>
</html>`;
  }
}

export default Ticket;
