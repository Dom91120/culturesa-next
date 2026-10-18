import { describe, expect, it } from "vitest";
import { assertSafeDump, confinePsqlScript, UnsafeDumpError } from "./backup-guard";

// Terminateur de bloc de données de pg_dump : antislash + point, seul sur sa ligne.
// Construit via String.raw pour qu'aucune couche d'échappement ne le dénature —
// une première version de ce test s'est fait piéger exactement là, et le cas
// « instruction APRÈS un bloc de données » passait alors pour non détecté.
const END = String.raw`\.`;

/** Dump minimal mais réaliste : en-tête pg_dump, DDL, bloc de données, DDL après. */
const dumpLegitime = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "SET statement_timeout = 0;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  'DROP TABLE IF EXISTS public."user";',
  'CREATE TABLE public."user" (id text NOT NULL, niveau text);',
  "CREATE TYPE public.\"Role\" AS ENUM ('utilisateur', 'gestionnaire');",
  'COPY public."user" (id, niveau) FROM stdin;',
  "abc\tCM1",
  END,
  'ALTER TABLE ONLY public."user" ADD CONSTRAINT user_pkey PRIMARY KEY (id);',
  "SELECT pg_catalog.setval('public.demandeurs_id_seq', 5, true);",
  "-- PostgreSQL database dump complete",
].join("\n");

describe("assertSafeDump — un dump légitime doit passer", () => {
  it("accepte un dump de structure pg_dump classique", () => {
    expect(() => assertSafeDump(dumpLegitime)).not.toThrow();
  });

  it("accepte les instructions normales de pg_dump", () => {
    // `set_config`, `setval`, `SET` : proches de motifs sensibles, mais légitimes.
    expect(() =>
      assertSafeDump("SELECT pg_catalog.set_config('search_path', '', false);"),
    ).not.toThrow();
    expect(() => assertSafeDump("SELECT pg_catalog.setval('s', 1, true);")).not.toThrow();
    expect(() => assertSafeDump("SET default_table_access_method = heap;")).not.toThrow();
  });

  it("accepte un dump vide", () => {
    expect(() => assertSafeDump("")).not.toThrow();
  });
});

describe("assertSafeDump — pas de faux positif sur les DONNÉES", () => {
  // Le point qui interdit un simple grep : un champ libre peut contenir n'importe
  // quel texte. Refuser ici rendrait des sauvegardes valides irrécupérables.
  it("ignore un texte dangereux situé dans un bloc de données", () => {
    const dump = [
      "CREATE TABLE public.t (v text);",
      "COPY public.t (v) FROM stdin;",
      "COPY x FROM PROGRAM 'echo rce'",
      "CREATE EXTENSION plperlu;",
      "DO $$ BEGIN END $$;",
      "SELECT pg_read_file('/etc/passwd');",
      END,
    ].join("\n");
    expect(() => assertSafeDump(dump)).not.toThrow();
  });

  it("ignore plusieurs blocs de données successifs", () => {
    const dump = [
      "COPY public.a (v) FROM stdin;",
      "ALTER SYSTEM SET x = 1;",
      END,
      "CREATE TABLE public.b (v text);",
      "COPY public.b (v) FROM stdin;",
      "CREATE EXTENSION plperlu;",
      END,
    ].join("\n");
    expect(() => assertSafeDump(dump)).not.toThrow();
  });
});

describe("assertSafeDump — instructions hors périmètre refusées", () => {
  const attaques: [string, string][] = [
    ["COPY FROM PROGRAM", "COPY t FROM PROGRAM 'id';"],
    ["COPY TO PROGRAM", "COPY (SELECT 1) TO PROGRAM 'id';"],
    ["réparti sur plusieurs lignes", "COPY t\n  FROM PROGRAM\n  'id';"],
    ["coupé par un commentaire bloc", "COPY t /* ruse */ FROM PROGRAM 'id';"],
    ["coupé par un commentaire ligne", "COPY t -- ruse\n FROM PROGRAM 'id';"],
    ["CREATE EXTENSION", "CREATE EXTENSION plperlu;"],
    ["bloc DO", "DO $$ BEGIN PERFORM 1; END $$;"],
    ["lecture de fichier serveur", "SELECT pg_read_file('/etc/passwd');"],
    ["écriture de fichier serveur", "SELECT pg_write_file('/tmp/x', 'y');"],
    ["large object vers fichier", "SELECT lo_export(1, '/tmp/x');"],
    ["ALTER SYSTEM", "ALTER SYSTEM SET log_statement = 'none';"],
    ["CREATE TABLESPACE", "CREATE TABLESPACE ts LOCATION '/data';"],
    ["rôle superutilisateur", "CREATE ROLE evil LOGIN SUPERUSER;"],
    ["élévation d'un rôle existant", "ALTER ROLE app WITH SUPERUSER;"],
    ["attribution d'un rôle privilégié", "GRANT pg_execute_server_program TO app;"],
    ["fonction en langage C", "CREATE FUNCTION f() RETURNS int AS 'x' LANGUAGE c;"],
    [
      "SECURITY DEFINER",
      "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER;",
    ],
    ["déclencheur d'événement", "CREATE EVENT TRIGGER e ON ddl_command_end EXECUTE FUNCTION f();"],
    ["source de données externe", "CREATE SERVER s FOREIGN DATA WRAPPER w;"],
  ];

  for (const [nom, sql] of attaques) {
    it(`refuse : ${nom}`, () => {
      expect(() => assertSafeDump(sql)).toThrow(UnsafeDumpError);
    });
  }

  it("refuse une instruction placée APRÈS un bloc de données", () => {
    // Contournement le plus naturel : se cacher derrière des données valides.
    const dump = [
      "COPY public.t (v) FROM stdin;",
      "donnee anodine",
      END,
      "COPY t FROM PROGRAM 'id';",
    ].join("\n");
    expect(() => assertSafeDump(dump)).toThrow(UnsafeDumpError);
  });

  it("refuse une instruction glissée dans un dump par ailleurs légitime", () => {
    expect(() => assertSafeDump(`${dumpLegitime}\nCOPY t FROM PROGRAM 'id';`)).toThrow(
      UnsafeDumpError,
    );
  });

  it("le message nomme ce qui a été trouvé", () => {
    expect(() => assertSafeDump("CREATE EXTENSION plperlu;")).toThrow(/CREATE EXTENSION/);
  });

  it("signale toutes les instructions trouvées, pas seulement la première", () => {
    let message = "";
    try {
      assertSafeDump("CREATE EXTENSION plperlu;\nALTER SYSTEM SET x = 1;");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/CREATE EXTENSION/);
    expect(message).toMatch(/ALTER SYSTEM/);
  });
});

describe("assertSafeDump — accepte un Buffer comme une chaîne", () => {
  it("traite les deux formes de la même façon", () => {
    expect(() => assertSafeDump(Buffer.from(dumpLegitime, "utf8"))).not.toThrow();
    expect(() => assertSafeDump(Buffer.from("CREATE EXTENSION x;", "utf8"))).toThrow(
      UnsafeDumpError,
    );
  });
});

// Méta-commandes psql (audit 2026-10-18). String.raw partout : l'antislash EST le sujet.
const KEY = "a".repeat(64);

describe("assertSafeDump — méta-commandes psql", () => {
  const attaques: [string, string][] = [
    ["shell", String.raw`\! id`],
    ["sortie vers un programme", String.raw`\o |sh`],
    ["copy vers un programme", String.raw`\copy (SELECT 1) TO PROGRAM 'id'`],
    ["inclusion de fichier", String.raw`\i /etc/passwd`],
    ["exécution du résultat", String.raw`\gexec`],
    ["désactivation d'ON_ERROR_STOP", String.raw`\set ON_ERROR_STOP 0`],
    ["indentée", String.raw`   \! id`],
    ["derrière un commentaire bloc", String.raw`/* ruse */ \! id`],
    [
      "après un bloc de données",
      ["COPY public.t (v) FROM stdin;", "x", END, String.raw`\! id`].join("\n"),
    ],
  ];
  for (const [nom, sql] of attaques) {
    it(`refuse : ${nom}`, () => {
      expect(() => assertSafeDump(sql)).toThrow(/méta-commande psql/);
    });
  }

  it("accepte le couple restrict / unrestrict émis par pg_dump 18", () => {
    const dump = [String.raw`\restrict Abc123`, dumpLegitime, String.raw`\unrestrict Abc123`];
    expect(() => assertSafeDump(dump.join("\n"))).not.toThrow();
  });

  it("ignore une méta-commande située dans un bloc de données", () => {
    const dump = ["COPY public.t (v) FROM stdin;", String.raw`\! id`, END].join("\n");
    expect(() => assertSafeDump(dump)).not.toThrow();
  });
});

describe("confinePsqlScript — mode restreint de psql", () => {
  const lines = (b: Buffer) => b.toString("latin1").split("\n");

  it("place la ligne restrict <clé> en tête, sans unrestrict", () => {
    const out = lines(confinePsqlScript(Buffer.from(dumpLegitime), KEY));
    expect(out[0]).toBe(String.raw`\restrict ` + KEY);
    expect(out.some((l) => l.startsWith(String.raw`\unrestrict`))).toBe(false);
    expect(out.slice(1).join("\n")).toBe(dumpLegitime);
  });

  it("retire le couple émis par pg_dump (un second restrict serait refusé)", () => {
    const dump = [String.raw`\restrict Dump42`, "SELECT 1;", String.raw`\unrestrict Dump42`, ""];
    expect(lines(confinePsqlScript(Buffer.from(dump.join("\n")), KEY))).toEqual([
      String.raw`\restrict ` + KEY,
      "SELECT 1;",
      "",
    ]);
  });

  it("ne touche pas aux lignes d'un bloc de données", () => {
    const dump = ["COPY public.t (v) FROM stdin;", String.raw`\restrict Dump42`, END].join("\n");
    expect(
      lines(confinePsqlScript(Buffer.from(dump), KEY))
        .slice(1)
        .join("\n"),
    ).toBe(dump);
  });

  it("préserve les octets, quel que soit l'encodage (CRLF, non-UTF-8)", () => {
    const raw = Buffer.from([0x53, 0x45, 0x4c, 0xe9, 0xff, 0x0d, 0x0a, 0x31, 0x3b]);
    const out = confinePsqlScript(raw, KEY);
    expect(out.subarray(out.indexOf(0x0a) + 1).equals(raw)).toBe(true);
  });

  it("refuse une clé faible ou non alphanumérique", () => {
    expect(() => confinePsqlScript(Buffer.from(""), "court")).toThrow();
    expect(() => confinePsqlScript(Buffer.from(""), `${KEY} x`)).toThrow();
  });
});
