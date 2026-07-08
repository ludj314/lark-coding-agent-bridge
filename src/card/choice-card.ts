export interface ChoiceOption {
  choice: string;
  label: string;
}

export interface ChoiceCardInput {
  title: string;
  choices: ChoiceOption[];
  action: string;
  sign: (choice: string) => string;
}

export function choiceCard(input: ChoiceCardInput): object {
  return {
    schema: '2.0',
    config: {
      enable_forward_interaction: false,
      streaming_mode: false,
      summary: { content: input.title },
    },
    body: {
      elements: [
        { tag: 'markdown', content: `**${input.title}**` },
        {
          tag: 'column_set',
          columns: input.choices.map((option, index) => ({
            tag: 'column',
            width: 'auto',
            elements: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: option.label },
                type: index === 0 ? 'primary' : 'default',
                behaviors: [
                  {
                    type: 'callback',
                    value: {
                      __bridge_cb: true,
                      bridge_token: input.sign(option.choice),
                      action: input.action,
                      choice: option.choice,
                      label: option.label,
                    },
                  },
                ],
              },
            ],
          })),
        },
      ],
    },
  };
}

export function selectedChoiceCard(input: { title: string; selectedLabel: string }): object {
  return {
    schema: '2.0',
    config: {
      enable_forward_interaction: false,
      streaming_mode: false,
      summary: { content: `已选择：${input.selectedLabel}` },
    },
    body: {
      elements: [
        { tag: 'markdown', content: `**${input.title}**` },
        { tag: 'markdown', content: `✅ 已选择：${input.selectedLabel}` },
      ],
    },
  };
}
