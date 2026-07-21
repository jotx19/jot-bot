"use client";

import Image from "next/image";

export function EmptyChat({
  title = "No chat selected",
  description = "Choose a chat from the sidebar and start the conversation.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-80 w-80 items-center justify-center overflow-hidden rounded-full bg-secondary/30 shadow-md">
        <Image
          src="/glossy.png"
          alt=""
          width={200}
          height={300}
          className="object-contain"
          priority
        />
      </div>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default EmptyChat;
