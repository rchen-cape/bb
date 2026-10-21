import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const AGENT_FORMATTING_INSTRUCTIONS = `Format replies so they are easy to scan. The user's app styles these markers:
- Start each action item the user needs to do with **Todo:** (bold, with the colon).
- Bold the single most important answer or conclusion in each reply.
- Start warnings with **Warning:** and important side notes with **Note:**.
- Put file paths, commands, flags, and identifiers in \`inline code\`.
- Tag every fenced code block with its language, for example \`\`\`bash or \`\`\`ts.`;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    styling: {
      type: "boolean",
      label: "Message styling",
      description:
        "Color bold and italic text, inline code, code blocks, headings, quotes, and message accents.",
      default: true,
    },
    intensity: {
      type: "select",
      label: "Intensity",
      description: "How strong the colors are.",
      options: ["subtle", "bold"],
      default: "subtle",
    },
    keywordHighlights: {
      type: "boolean",
      label: "Key-text highlights",
      description:
        "Color Todo:, Note:, errors, warnings, file paths, numbers with units, and issue references in agent replies.",
      default: true,
    },
    customKeywords: {
      type: "string",
      label: "Extra keywords",
      description:
        "Comma-separated words or phrases to highlight in agent replies.",
      default: "",
    },
    agentHints: {
      type: "boolean",
      label: "Ask agents to mark key text",
      description:
        "Tell agents to start action items with **Todo:**, bold the main conclusion, and tag code blocks.",
      default: true,
    },
  });

  let agentHints = (await settings.get()).agentHints;
  settings.onChange((next) => {
    agentHints = next.agentHints;
  });

  bb.agents.contributeInstructions(() =>
    agentHints ? AGENT_FORMATTING_INSTRUCTIONS : null,
  );
}
