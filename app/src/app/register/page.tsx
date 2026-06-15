import Link from "next/link";
import { BookOpen } from "@phosphor-icons/react/dist/ssr";
import { AuthForm } from "@/components/auth-form";

// P-1 登入 / 註冊（註冊入口）— 帳簿風
export default function RegisterPage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 bg-paper p-6">
      <Link href="/" className="flex flex-col items-center gap-4 text-center transition hover:opacity-80">
        <span className="flex h-14 w-14 items-center justify-center rounded-[3px] border-2 border-ink text-ink">
          <BookOpen size={26} weight="bold" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">室友分帳</h1>
          <p className="mt-1 text-sm text-text-3">一本攤開就清楚的共同帳簿</p>
        </div>
      </Link>
      <div className="w-full max-w-sm rounded-[3px] border border-rule p-8">
        <AuthForm initialMode="register" />
      </div>
      <p className="text-xs text-text-3">只算錢，不經手金流</p>
    </main>
  );
}
