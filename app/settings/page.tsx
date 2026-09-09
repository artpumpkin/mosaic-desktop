"use client";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import ErrorCard from "@/components/ErrorCard";
import { useWide } from "@/lib/appLayout";
import {
  Settings as SettingsIcon,
  KeyRound,
  Database,
  Coins,
  Info,
  ArrowLeftRight,
  Ruler,
  Film,
  Trash2,
} from "lucide-react";
import {
  getBaseCurrency,
  getAlchemyApiKey,
  getRealDebridApiKey,
  getUnitsPreference,
  type BaseCurrency,
} from "@/lib/settings";
import type { UnitsPreference } from "@/lib/health/units";
import {
  BaseCurrencyForm,
  AlchemyKeyForm,
  RealDebridKeyForm,
  UnitsPreferenceForm,
} from "@/components/forms/SettingsForms";
import { DataIO } from "@/components/forms/DataIO";
import { MediaDataControls } from "@/components/forms/MediaDataControls";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useEffect, useState } from "react";

type PageData = {
  base: BaseCurrency;
  alchemyKey: string | null;
  rdKey: string | null;
  unitsPref: UnitsPreference;
};

async function load(): Promise<PageData> {
  const [base, alchemyKey, rdKey, unitsPref] = await Promise.all([
    getBaseCurrency(),
    getAlchemyApiKey(),
    getRealDebridApiKey(),
    getUnitsPreference(),
  ]);
  return { base, alchemyKey, rdKey, unitsPref };
}

export default function SettingsPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["settings"], load);
  const [appVersion, setAppVersion] = useState<string>("");
  useEffect(() => {
    import("@tauri-apps/api/app").then((m) => m.getVersion().then(setAppVersion));
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={SettingsIcon}
            title="Settings"
            subtitle="Records are stored locally. Connected features use external services; exchange credentials use a local encryption key."
          />

          {error ? (
            <ErrorCard message={error} onRetry={reload} />
          ) : !data ? (
            <PageSkeleton />
          ) : (
            <SettingsBody data={data} appVersion={appVersion} />
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsBody({
  data,
  appVersion,
}: {
  data: PageData;
  appVersion: string;
}) {
  const { base, alchemyKey, rdKey, unitsPref } = data;
  const alchemyConfigured = Boolean(alchemyKey);

  return (
    <div className="grid gap-6 xl:grid-cols-2 2xl:grid-cols-3 items-start">
      <GlassCard>
        <h2 className="font-medium mb-2 flex items-center gap-2">
          <Ruler size={16} className="text-emerald-300" /> Units
        </h2>
        <p className="text-sm text-neutral-400 mb-4 max-w-prose">
          Affects weight, height, and other health measurements. Underlying
          data is always stored in metric — only the display changes.
        </p>
        <UnitsPreferenceForm current={unitsPref} />
      </GlassCard>

      <GlassCard>
        <h2 className="font-medium mb-2 flex items-center gap-2">
          <Coins size={16} className="text-violet-300" /> Display currency
        </h2>
        <p className="text-sm text-neutral-400 mb-4 max-w-prose">
          All totals across the app are converted to this currency for display.
          Underlying records keep their original currency.
        </p>
        <BaseCurrencyForm current={base} />
      </GlassCard>

      <GlassCard>
        <h2 className="font-medium mb-2 flex items-center gap-2">
          <KeyRound size={16} className="text-violet-300" /> Alchemy API key
        </h2>
        <p className="text-sm text-neutral-400 mb-4 max-w-prose">
          Required for fetching ETH wallet balances. Get a free key at{" "}
          <a
            className="underline"
            href="https://www.alchemy.com"
            target="_blank"
            rel="noreferrer"
          >
            alchemy.com
          </a>
          . Stored locally in your finance database.
        </p>
        <AlchemyKeyForm current={alchemyKey ?? ""} />
        <p
          className={`text-xs mt-2 ${
            alchemyConfigured ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          {alchemyConfigured
            ? "Configured — wallet refresh is enabled."
            : "Not configured — wallet refresh is disabled."}
        </p>
      </GlassCard>

      <GlassCard>
        <h2 className="font-medium mb-2 flex items-center gap-2">
          <Film size={16} className="text-rose-300" /> Real-Debrid API token
        </h2>
        <p className="text-sm text-neutral-400 mb-4 max-w-prose">
          Optional. With a token, the Movies section streams torrents instantly
          via Real-Debrid&apos;s CDN. Without it, playback uses the built-in torrent
          engine (slower start, no account needed). Generate a token at{" "}
          <a
            className="underline"
            href="https://real-debrid.com/apitoken"
            target="_blank"
            rel="noreferrer"
          >
            real-debrid.com/apitoken
          </a>
          .
        </p>
        <RealDebridKeyForm current={rdKey ?? ""} />
      </GlassCard>

      <GlassCard>
        <h2 className="font-medium mb-2 flex items-center gap-2">
          <ArrowLeftRight size={16} className="text-violet-300" /> Backup &amp; transfer
        </h2>
        <p className="text-sm text-neutral-400 mb-4 max-w-prose">
          Export finance records, weight entries, fasting sessions and database
          settings, including exchange credentials, to a passphrase-encrypted
          JSON file. Media files, rentals and browser-stored module data are not
          included. Import with the same passphrase to restore these records.
          Lose the passphrase and the backup is unreadable —
          there&apos;s no recovery path.
        </p>
        <DataIO />
      </GlassCard>

      <GlassCard>
        <h2 className="font-medium mb-2 flex items-center gap-2">
          <Trash2 size={16} className="text-rose-300" /> Media data
        </h2>
        <p className="text-sm text-neutral-400 mb-4 max-w-prose">
          Clear what the Movies &amp; TV sections remember on this device —
          continue-watching, favorites, recently-watched, and cached channel
          lists. Each row needs two clicks to confirm: click once to arm, then
          click again within a few seconds to wipe. Only local data is removed;
          nothing re-downloads until you open the section again.
        </p>
        <MediaDataControls />
      </GlassCard>

      <GlassCard>
        <h2 className="font-medium mb-2 flex items-center gap-2">
          <Info size={16} className="text-violet-300" /> About
        </h2>
        <div className="grid gap-2.5 text-sm">
          <Row icon={Info} label="Version" value={appVersion || "—"} mono />
          <Row
            icon={Database}
            label="Database"
            value="OS app-data dir (per-user)"
          />
        </div>
      </GlassCard>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="flex items-center gap-2 text-sm text-neutral-400 shrink-0">
        <Icon size={14} />
        {label}
      </span>
      <span
        className={`text-xs text-neutral-300 ${
          mono ? "font-mono break-all" : ""
        } sm:text-right`}
      >
        {value}
      </span>
    </div>
  );
}
