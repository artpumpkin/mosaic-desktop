"use client";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import ErrorCard from "@/components/ErrorCard";
import { Tv } from "lucide-react";
import Link from "next/link";
import { useWide } from "@/lib/appLayout";
import { getTvSources } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import {
  ActiveTvSourceForm,
  AddTvSourceForm,
  PlaylistsTable,
} from "@/components/forms/TvSourcesForms";

export default function TvSettingsPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["tv:sources"], getTvSources);

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={Tv}
            title="TV playlists"
            subtitle="Manage your M3U playlists and switch the active source."
            right={
              <Link
                href="/tv"
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-[12px] border bg-white/[0.04] border-white/10 text-neutral-300 hover:bg-white/[0.06]"
              >
                Back to TV
              </Link>
            }
          />

          {error ? (
            <ErrorCard message={error} onRetry={reload} />
          ) : !data ? (
            <PageSkeleton />
          ) : (
            <>
              <GlassCard>
                <h2 className="font-medium">Your playlists</h2>
                <p className="text-sm text-neutral-400 mt-1 mb-4 max-w-prose">
                  M3U playlists you&apos;ve added. Click the pencil to rename or
                  change the URL.
                </p>
                <PlaylistsTable state={data} />
              </GlassCard>

              <div className="grid gap-6 xl:grid-cols-2 items-start">
                <GlassCard>
                  <h2 className="font-medium">Active source</h2>
                  <p className="text-sm text-neutral-400 mt-1 mb-4 max-w-prose">
                    Channels currently shown on the TV page come from this
                    source.
                  </p>
                  <ActiveTvSourceForm state={data} />
                </GlassCard>

                <GlassCard>
                  <h2 className="font-medium">Add a playlist</h2>
                  <p className="text-sm text-neutral-400 mt-1 mb-4 max-w-prose">
                    Paste an M3U URL from your IPTV provider. EPG (XMLTV) is
                    optional and stored for future use.
                  </p>
                  <AddTvSourceForm onAdded={reload} />
                </GlassCard>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
