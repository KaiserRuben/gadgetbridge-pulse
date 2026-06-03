import { permanentRedirect } from "next/navigation";

export default function LegacyHomeRedirect(): never {
  permanentRedirect("/v4");
}
