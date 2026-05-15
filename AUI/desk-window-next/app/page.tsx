import { DeskWindow } from "@/components/DeskWindow";

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-x-hidden px-4 py-10 sm:py-16">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[12%] top-0 h-64 w-64 rounded-full bg-[#FFE7D9] blur-3xl" />
        <div className="absolute bottom-10 right-[10%] h-56 w-56 rounded-full bg-[#FFF3CF] blur-3xl" />
      </div>

      <div className="relative mx-auto flex max-w-6xl justify-center">
        <DeskWindow />
      </div>
    </main>
  );
}
