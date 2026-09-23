# `infra/observability` — i pezzi additivi

Questo stack **non** contiene Grafana e **non** contiene Loki. Ce li hai già, creati dalla
UI di Portainer, con la raccolta dei log dal socket docker. Un secondo Grafana accanto al
primo vorrebbe dire due posti in cui cercare un grafico e due in cui configurare un
datasource — e il secondo diventerebbe quello aggiornato a metà.

Quello che aggiunge:

| Servizio     | Perché                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| `alloy`      | riceve OTLP dalle app e smista. L'unico endpoint che le app conoscono  |
| `tempo`      | le trace, più le metriche RED generate da loro senza strumentare nulla |
| `prometheus` | il magazzino delle metriche                                            |

E, dietro profilo perché potresti già averli:

| Profilo            | Cosa accende                             |
| ------------------ | ---------------------------------------- |
| `host-metrics`     | node-exporter + cAdvisor                 |
| `postgres-metrics` | postgres-exporter sul Postgres condiviso |
| `errors`           | GlitchTip (+ il suo Redis)               |

---

## Prima del deploy: le reti

È il passo che, saltato, fa sembrare tutto rotto senza un errore chiaro — i container
partono, semplicemente non si vedono fra loro.

```bash
docker network create observability
```

Poi **il tuo stack Grafana/Loki deve entrare in questa rete**. In Portainer: stack
esistente → Editor → aggiungi alla sezione `networks` del servizio Grafana:

```yaml
services:
  grafana:
    networks:
      - default
      - observability

networks:
  observability:
    external: true
```

Senza, i datasource puntano a `http://tempo:3200` e Grafana non risolve il nome.

`postgres_network` è quella che il Postgres condiviso usa già: serve solo ai profili
`postgres-metrics` ed `errors`.

---

## Deploy su Portainer

Stack a sé, con il repository puntato su `infra/observability`:

- **Repository URL**: questo repo
- **Compose path**: `infra/observability/compose.yml`
- **Environment variables**: i valori di `.env.example`

I profili si attivano con `COMPOSE_PROFILES` fra le variabili d'ambiente dello stack,
per esempio `COMPOSE_PROFILES=host-metrics,errors`.

---

## Collegare le applicazioni

Una variabile:

```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318
OTEL_SERVICE_NAME=saas-template-api
```

`http://alloy:4318` se lo stack dell'app sta su `observability`; altrimenti
`http://<host>:4318`, che è il motivo per cui le porte sono pubblicate.

Le app non conoscono né Tempo né Prometheus, ed è il punto: sostituire un backend è una
modifica a `alloy/config.alloy`, non un redeploy di ogni servizio.

---

## Collegare Grafana

1. `grafana/datasources/saas-template.yml` — montalo nel provisioning del tuo Grafana, o
   ricrea gli stessi campi dalla UI. **Cambia `datasourceUid: loki`** con l'uid del tuo
   Loki, o il salto trace → log non funziona.
2. `grafana/datasources/loki-derived-fields.md` — il pezzo da aggiungere **al tuo**
   datasource Loki per il salto inverso, log → trace. È quello che serve più spesso.

---

## Verificare che funzioni davvero

Nessuno di questi passi è opzionale se vuoi sapere di avere osservabilità invece di
sperarlo. Sono gli stessi con cui è stato verificato questo stack.

**1. I container sono su.** Tempo non ha un healthcheck — la sua immagine è distroless,
niente shell né wget, quindi un healthcheck interno resterebbe `unhealthy` per sempre e
bloccherebbe chi ci dipende. Si controlla da fuori:

```bash
docker run --rm --network observability curlimages/curl -sf http://tempo:3200/ready
```

Risponde `503` per il primo minuto: l'ingester sta entrando nel ring. È normale.

**2. Una richiesta produce una trace.** Fai una chiamata all'API, prendi il `trace_id` da
una riga di log, e chiedilo a Tempo:

```bash
docker run --rm --network observability curlimages/curl -s \
  http://tempo:3200/api/traces/<trace_id>
```

**3. Le metriche arrivano.** `subscriptions_active` è quella che esiste sempre, anche
senza traffico, perché è un gauge letto a ogni export:

```bash
docker run --rm --network observability curlimages/curl -s \
  'http://prometheus:9090/api/v1/label/__name__/values' | grep subscriptions_active
```

Se manca: Prometheus è partito senza `--web.enable-remote-write-receiver` e sia Alloy sia
Tempo stanno scrivendo verso un 404 senza che nulla lo dica.

**4. Le metriche RED esistono.** `traces_service_graph_request_server_seconds_count` e
`traces_spanmetrics_*` le genera Tempo dalle trace. Se ci sono, il generatore funziona e
il grafo dei servizi in Grafana si disegna da solo.

**5. Il salto log → trace.** In Explore, una riga di log dell'API deve mostrare un bottone
verso Tempo accanto a `trace_id`. Se il campo non compare, il tuo Loki non sta facendo il
parsing JSON della riga: si sistema lì, non qui.

---

## Quello che questo stack non fa

- **Non raccoglie i log.** Restano su stdout e li prende la tua raccolta esistente. Il
  pipeline log di OTLP è spento di proposito nell'applicazione: acceso, ogni riga
  finirebbe in Loki due volte sotto etichette diverse.
- **Non fa alerting.** Le regole di alert stanno dove sta Grafana, che è tuo.
- **Non fa backup.** È `infra/backup/`, un altro stack, ancora da scrivere.
