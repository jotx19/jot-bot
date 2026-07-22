"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

export default function ChatIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/chat/${crypto.randomUUID()}`);
  }, [router]);

  return (
    <div className="flex min-h-svh w-full flex-col">
      <div className="sticky top-0 z-40 px-3 pb-2 pt-3 md:px-4 md:pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="hidden h-9 w-40 rounded-full md:block" />
          </div>
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 py-8">
        <Skeleton className="ml-auto h-11 w-[45%] rounded-2xl" />
        <Skeleton className="h-16 w-[70%] rounded-2xl" />
        <Skeleton className="ml-auto h-10 w-[35%] rounded-2xl" />
        <Skeleton className="h-24 w-[80%] rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-[50%] rounded-2xl" />
      </div>

      <div className="sticky bottom-0 px-3 pb-4 md:px-4">
        <Skeleton className="mx-auto h-12 w-full max-w-2xl rounded-2xl" />
      </div>
    </div>
  );
}
