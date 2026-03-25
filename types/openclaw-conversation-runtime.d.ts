declare module "openclaw/plugin-sdk/conversation-runtime" {
  export type ConversationRef = {
    channel: string;
    accountId: string;
    conversationId: string;
    parentConversationId?: string;
    threadId?: string | number;
  };

  export type SessionBindingRecord = {
    bindingId?: string;
    targetSessionKey: string;
  };

  export function resolveConversationBindingRecord(
    conversation: ConversationRef,
  ): SessionBindingRecord | null;
}
