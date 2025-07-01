"use client";

import { BotMessageSquare } from "lucide-react";

export function Header() {
  return (
    <header className="flex items-center justify-between p-4 border-b shrink-0">
      <div className="flex items-center gap-2">
        <BotMessageSquare className="w-8 h-8 text-primary" />
        <h1 className="text-2xl font-bold tracking-wider text-primary font-headline">
          Retro Crypto Alchemist
        </h1>
      </div>
    </header>
  );
}
