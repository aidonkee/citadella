import { createFileRoute } from "@tanstack/react-router";
import { ChatsSidebar } from "./chats.$chatId";

export const Route = createFileRoute("/_authenticated/chats/")({
  component: () => (
    <div className="flex h-full">
      <ChatsSidebar />
      <div className="flex-1 hidden md:flex items-center justify-center text-muted-foreground">
        Выберите чат слева
      </div>
      <div className="flex-1 md:hidden flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Выберите чат из списка
      </div>
    </div>
  ),
});
