import { expect } from "chai";
import * as apiFootball from "./apiFootball";
import * as footballData from "./footballData";
import { consensus, linkFixtures, nameSimilarity } from "./match";
import * as openligadb from "./openligadb";
import * as pandascore from "./pandascore";
import * as thesportsdb from "./thesportsdb";
import type { SourceFixture, Vote } from "./types";

const realFetch = globalThis.fetch;

function stubFetch(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

const fx = (
  sourceId: string,
  home: string,
  away: string,
  startTime: number,
): SourceFixture => ({
  source: "openligadb",
  sourceId,
  category: "football",
  league: "x",
  home,
  away,
  startTime,
  status: "scheduled",
  final: null,
});

describe("team name matching", () => {
  it("ignores club-form tokens and diacritics", () => {
    expect(nameSimilarity("Werder Bremen", "SV Werder Bremen")).to.equal(1);
    expect(nameSimilarity("Bayern Munich", "FC Bayern München")).to.equal(1);
    expect(nameSimilarity("FC Koln", "1. FC Köln")).to.equal(1);
    expect(nameSimilarity("Mainz", "1. FSV Mainz 05")).to.equal(1);
    expect(nameSimilarity("Hamburger SV", "Hamburg")).to.equal(1);
  });

  it("does not pair clubs that only share a generic word", () => {
    const base = [
      {
        ...fx("1", "Borussia Dortmund", "Werder Bremen", 1000),
        source: "thesportsdb" as const,
      },
    ];
    const other = [
      fx("9", "Borussia Mönchengladbach", "SV Werder Bremen", 1000),
    ];
    expect(linkFixtures(base, other).size).to.equal(0);
  });

  it("links one-to-one inside the kickoff window only", () => {
    const base = [
      {
        ...fx("1", "Dortmund", "Werder Bremen", 10_000),
        source: "thesportsdb" as const,
      },
      {
        ...fx("2", "Augsburg", "Bayern Munich", 10_000),
        source: "thesportsdb" as const,
      },
    ];
    const other = [
      fx("a", "Borussia Dortmund", "SV Werder Bremen", 10_000 + 600),
      fx("b", "FC Augsburg", "FC Bayern München", 10_000 + 3_600),
    ];
    const links = linkFixtures(base, other);
    expect(links.get("1")).to.equal("a");
    expect(links.has("2")).to.equal(false);
  });
});

describe("consensus", () => {
  const final = (source: Vote["source"], home: number, away: number): Vote => ({
    source,
    sourceId: "1",
    status: "final",
    score: { home, away },
  });

  it("agrees when every final vote is identical and ignores abstentions", () => {
    const c = consensus([
      final("thesportsdb", 2, 1),
      final("openligadb", 2, 1),
      { source: "footballData", sourceId: "1", status: "pending", note: "429" },
    ]);
    expect(c.verdict).to.equal("agree");
  });

  it("disputes on a different margin even with the same winner, with no majority rule", () => {
    const c = consensus([
      final("thesportsdb", 2, 1),
      final("openligadb", 2, 1),
      final("apiFootball", 3, 1),
    ]);
    expect(c.verdict).to.equal("dispute");
  });

  it("disputes when any source reports the event as void", () => {
    const c = consensus([
      final("thesportsdb", 0, 0),
      {
        source: "footballData",
        sourceId: "1",
        status: "void",
        note: "POSTPONED",
      },
    ]);
    expect(c.verdict).to.equal("dispute");
  });

  it("waits while nobody has a final score", () => {
    expect(
      consensus([
        {
          source: "thesportsdb",
          sourceId: "1",
          status: "pending",
          note: "live",
        },
      ]).verdict,
    ).to.equal("waiting");
  });
});

describe("provider normalisation", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.FOOTBALL_DATA_KEY;
    delete process.env.API_FOOTBALL_KEY;
  });

  it("OpenLigaDB reports only finished matches, using the regular-time result", async () => {
    const match = {
      matchID: 83191,
      matchDateTimeUTC: "2026-09-20T17:30:00Z",
      leagueName: "1. Fußball-Bundesliga 2026/2027",
      team1: { teamName: "SC Paderborn 07" },
      team2: { teamName: "TSG Hoffenheim" },
      matchResults: [
        { resultTypeID: 1, pointsTeam1: 2, pointsTeam2: 0 },
        { resultTypeID: 2, pointsTeam1: 3, pointsTeam2: 1 },
      ],
    };
    stubFetch({ ...match, matchIsFinished: true });
    expect(await openligadb.result("83191")).to.deep.include({
      status: "final",
      score: { home: 3, away: 1 },
    });
    stubFetch({ ...match, matchIsFinished: false });
    expect((await openligadb.result("83191")).status).to.equal("pending");
  });

  it("TheSportsDB marks postponed events void and finished ones final", async () => {
    const e = {
      idEvent: "1",
      strLeague: "L",
      strHomeTeam: "A",
      strAwayTeam: "B",
      strTimestamp: "2026-09-19T19:00:00",
      dateEvent: null,
      strTime: null,
      intHomeScore: "1",
      intAwayScore: "3",
      strStatus: "FT",
      strPostponed: "no",
    };
    stubFetch({ events: [e] });
    expect(await thesportsdb.result("1")).to.deep.include({
      status: "final",
      score: { home: 1, away: 3 },
    });
    stubFetch({ events: [{ ...e, strStatus: "1H" }] });
    expect((await thesportsdb.result("1")).status).to.equal("pending");
    stubFetch({
      events: [
        { ...e, intHomeScore: null, intAwayScore: null, strPostponed: "yes" },
      ],
    });
    expect((await thesportsdb.result("1")).status).to.equal("void");
  });

  it("football-data uses regular time when the match went to extra time", async () => {
    process.env.FOOTBALL_DATA_KEY = "k";
    stubFetch({
      id: 5,
      utcDate: "2026-09-19T19:00:00Z",
      status: "FINISHED",
      competition: { name: "CL" },
      homeTeam: { name: "A" },
      awayTeam: { name: "B" },
      score: {
        duration: "EXTRA_TIME",
        fullTime: { home: 2, away: 1 },
        regularTime: { home: 1, away: 1 },
      },
    });
    expect(await footballData.result("5")).to.deep.include({
      status: "final",
      score: { home: 1, away: 1 },
    });
  });

  it("sources without a key abstain instead of voting", async () => {
    expect((await footballData.result("5")).status).to.equal("pending");
    expect((await apiFootball.result("5")).status).to.equal("pending");
  });

  it("PandaScore maps videogame slugs to proper categories", () => {
    expect(pandascore.categoryOf("cs-go")).to.equal("esports_cs2");
    expect(pandascore.categoryOf("csgo")).to.equal("esports_cs2");
    expect(pandascore.categoryOf("cs-2")).to.equal("esports_cs2");
    expect(pandascore.categoryOf("league-of-legends")).to.equal("esports_lol");
    expect(pandascore.categoryOf("lol")).to.equal("esports_lol");
    expect(pandascore.categoryOf("dota-2")).to.equal("esports");
    expect(pandascore.categoryOf("valorant")).to.equal("esports");
    expect(pandascore.categoryOf("unknown")).to.equal("esports");
  });
});

describe("timestamps and unknown kickoff", () => {
  it("preserves offsets and retains date-only events as non-marketable TBD", () => {
    const base = {
      idEvent: "1",
      strLeague: "L",
      strHomeTeam: "A",
      strAwayTeam: "B",
      intHomeScore: null,
      intAwayScore: null,
      strTimestamp: "2026-10-10T15:00:00+02:00",
      dateEvent: "2026-10-10",
      strTime: null,
    };
    const exact = thesportsdb.toFixture(base, "football", 0)!;
    expect(exact.startTime).to.equal(Date.parse("2026-10-10T13:00:00Z") / 1000);
    expect(exact.timeTBD).to.equal(false);
    const tbd = thesportsdb.toFixture(
      { ...base, strTimestamp: null },
      "football",
      0,
    )!;
    expect(tbd.timeTBD).to.equal(true);
    expect(tbd.startTime).to.equal(Date.parse("2026-10-10T12:00:00Z") / 1000);
    expect(
      thesportsdb.toFixture(
        { ...base, strTimestamp: null, dateEvent: "2026-02-30" },
        "football",
        0,
      ),
    ).to.equal(null);
  });
});
