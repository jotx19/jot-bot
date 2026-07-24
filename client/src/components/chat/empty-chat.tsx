"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export function EmptyChat({
  title = "No chat selected",
  description = "Choose a chat from the sidebar and start the conversation.",
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center px-5 py-8 text-center",
        className
      )}
    >
      <div
        className={cn(
          "mb-3 flex items-center justify-center overflow-hidden rounded-full bg-secondary/30 shadow-md",
          "size-28 sm:size-40 md:mb-4 md:size-80"
        )}
      >
        <Image
          src="/glossy.png"
          alt=""
          width={320}
          height={320}
          className="size-[70%] object-contain md:size-[62%]"
          priority
        />
      </div>
      <h2 className="text-base font-semibold text-foreground sm:text-lg md:text-2xl">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[16rem] text-xs leading-relaxed text-muted-foreground sm:mt-2 sm:max-w-sm sm:text-sm md:text-base">
        {description}
      </p>
    </div>
  );
}

export default EmptyChat;
