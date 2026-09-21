import http from 'node:http';

/**
 * No connection pooling in the test process.
 *
 * Node 19 turned `keepAlive` on for `http.globalAgent`, and supertest uses it. Every
 * request listens on an ephemeral port, every spec builds and closes its own Nest
 * application, and the operating system recycles those port numbers — so a pooled
 * socket to 127.0.0.1:PORT can be handed to a request aimed at a *different*
 * application, or at one that has since been closed.
 *
 * That is the shape of the flake this suite chased for weeks: it appeared only in long
 * full runs, never in isolation, always as damage at the HTTP layer rather than in the
 * logic under test — `Parse Error: Expected HTTP/, RTSP/ or ICE/` when the bytes came
 * from nowhere sensible, and `404` when the request landed on an application that did
 * not have that route.
 *
 * Pooling buys nothing here: the suite is sequential and the cost of a fresh socket is
 * invisible next to booting a Nest application per file.
 */
http.globalAgent = new http.Agent({ keepAlive: false });
