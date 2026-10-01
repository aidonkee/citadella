import { createFileRoute } from "@tanstack/react-router";
import { ChatsSidebar } from "./chats.$chatId";

export const Route = createFileRoute("/_authenticated/chats/")({
  component: () => (
    <div className="flex h-full min-w-0">
      <ChatsSidebar />
      <div className="flex-1 hidden md:flex items-center justify-center text-muted-foreground">
        Выберите чат слева
      </div>
    </div>
  ),
});
