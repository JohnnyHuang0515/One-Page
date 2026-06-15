// P-0 墨流し首頁:互動水墨畫布。
// 未登入 → 自由玩墨 + 「登入」入口;已登入 → 自動演出重播帳本當月記帳 + 「帳本」入口。
import { getCurrentUser } from "@/lib/session";
import { getHomeReplay } from "@/lib/home-replay";
import { SuminagashiHome } from "@/components/ink/suminagashi-home";

export default async function Home() {
  const user = await getCurrentUser();
  const replay = user ? getHomeReplay(user.id) : null;
  return <SuminagashiHome loggedIn={!!user} replay={replay} />;
}
