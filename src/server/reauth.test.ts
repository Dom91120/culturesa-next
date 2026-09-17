import { beforeEach, describe, expect, it, vi } from "vitest";

// La base est simulée : ces tests portent sur l'ENCHAÎNEMENT des contrôles
// (session, quota, compte, comparaison, remise à zéro), pas sur PostgreSQL. Le seau
// de freinage est piloté par ce que renvoie `$queryRaw` (compteur APRÈS incrément).
const queryRaw = vi.fn();
const findFirst = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/server/db", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    account: { findFirst: (...a: unknown[]) => findFirst(...a) },
    throttleBucket: { deleteMany: (...a: unknown[]) => deleteMany(...a) },
  },
}));

const sessionState: { present: boolean } = { present: true };
vi.mock("@/server/guards", () => ({
  getSession: vi.fn(async () =>
    sessionState.present ? { user: { id: "u1", email: "a@exemple.test" } } : null,
  ),
}));

const verifyPassword = vi.fn();
vi.mock("better-auth/crypto", () => ({
  verifyPassword: (...a: unknown[]) => verifyPassword(...a),
}));

const { REAUTH_MAX_ATTEMPTS, REAUTH_THROTTLED_MSG, ReauthError, reauthOrError, requireReauth } =
  await import("./reauth");

/** Le seau rapporte `count` après incrément (cf. rate-limit.ts, seuil `<= max`). */
const seau = (count: number) => queryRaw.mockResolvedValue([{ count }]);

beforeEach(() => {
  queryRaw.mockReset();
  findFirst.mockReset();
  deleteMany.mockReset();
  verifyPassword.mockReset();
  sessionState.present = true;
  seau(1);
  findFirst.mockResolvedValue({ password: "hash" });
  deleteMany.mockResolvedValue({ count: 1 });
  verifyPassword.mockResolvedValue(true);
});

describe("requireReauth — enchaînement des contrôles", () => {
  it("mot de passe vide → refus sans toucher ni la base ni le seau", async () => {
    await expect(requireReauth("")).rejects.toBeInstanceOf(ReauthError);
    await expect(requireReauth(undefined)).rejects.toBeInstanceOf(ReauthError);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("sans session → refus, aucun seau consommé", async () => {
    sessionState.present = false;
    await expect(requireReauth("x")).rejects.toThrow(/Session expirée/);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("bon mot de passe → passe et vide le seau de l'utilisateur", async () => {
    await expect(requireReauth("bon")).resolves.toBeUndefined();
    expect(verifyPassword).toHaveBeenCalledWith({ hash: "hash", password: "bon" });
    expect(deleteMany).toHaveBeenCalledWith({ where: { key: "reauth:u1" } });
  });

  it("mauvais mot de passe → refus, le seau reste armé", async () => {
    verifyPassword.mockResolvedValue(false);
    await expect(requireReauth("faux")).rejects.toThrow("Mot de passe incorrect.");
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("compte sans mot de passe → refus (l'absence de moyen n'est pas une vérification)", async () => {
    findFirst.mockResolvedValue(null);
    await expect(requireReauth("x")).rejects.toThrow(/ne peut pas confirmer/);
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});

describe("requireReauth — freinage par utilisateur (S1)", () => {
  it("consomme un essai AVANT la comparaison, sur la clé de l'utilisateur", async () => {
    await requireReauth("bon");
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // Les valeurs interpolées de la requête taguée : la clé vient en premier.
    const valeurs = queryRaw.mock.calls[0]?.slice(1) ?? [];
    expect(valeurs).toContain("reauth:u1");
    expect(valeurs.some((v) => String(v).startsWith(String(15 * 60_000)))).toBe(true);
  });

  it("au-delà du seuil → refus par quota, sans comparer le mot de passe", async () => {
    seau(REAUTH_MAX_ATTEMPTS + 1);
    await expect(requireReauth("bon")).rejects.toThrow(REAUTH_THROTTLED_MSG);
    expect(findFirst).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("le refus par quota ne dit pas si le mot de passe était juste", async () => {
    // Même message, mot de passe juste ou faux : rien à apprendre en insistant.
    seau(REAUTH_MAX_ATTEMPTS + 1);
    verifyPassword.mockResolvedValue(true);
    const juste = await reauthOrError("bon");
    verifyPassword.mockResolvedValue(false);
    const faux = await reauthOrError("faux");
    expect(juste).toEqual({ ok: false, error: REAUTH_THROTTLED_MSG });
    expect(faux).toEqual(juste);
  });

  it("le dernier essai autorisé passe encore (seuil inclusif)", async () => {
    seau(REAUTH_MAX_ATTEMPTS);
    await expect(requireReauth("bon")).resolves.toBeUndefined();
  });

  it("base muette → échec FERMÉ : refus par quota", async () => {
    queryRaw.mockRejectedValue(new Error("connexion perdue"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(requireReauth("bon")).rejects.toThrow(REAUTH_THROTTLED_MSG);
      expect(verifyPassword).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it("remise à zéro impossible → la confirmation valide passe quand même", async () => {
    deleteMany.mockRejectedValue(new Error("connexion perdue"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(requireReauth("bon")).resolves.toBeUndefined();
    } finally {
      err.mockRestore();
    }
  });
});

describe("reauthOrError — enveloppe des server actions", () => {
  it("succès → null", async () => {
    expect(await reauthOrError("bon")).toBeNull();
  });
  it("refus motivé → { ok:false, error } avec le message tel quel", async () => {
    verifyPassword.mockResolvedValue(false);
    expect(await reauthOrError("faux")).toEqual({ ok: false, error: "Mot de passe incorrect." });
  });
});
