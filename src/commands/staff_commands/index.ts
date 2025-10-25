import SlashCommand from "../../classes/slash_command";
import removeTicketParticipant from "./remove_ticket_participant";
import verify from "./verify";
import view_purchases from "./view_purchases";
import export_transcript from "./export_transcript";

export default [
  verify,
  view_purchases,
  removeTicketParticipant,
  export_transcript,
] as SlashCommand[];
