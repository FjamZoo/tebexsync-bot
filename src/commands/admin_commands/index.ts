import SlashCommand from "../../classes/slash_command";
import settings_manager from "./settings_manager";
import ticket_category from "./ticket_category";
import ticket_field from "./ticket_field";

export default [
  settings_manager,
  ticket_category,
  ticket_field,
] as SlashCommand[];
