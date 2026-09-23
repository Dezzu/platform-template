# Il pezzo che devi aggiungere al TUO datasource Loki

Questo stack non tocca il tuo Loki, quindi l'ultimo anello della catena va aggiunto a
mano — una volta sola.

Serve a fare il salto **inverso**: dalla riga di log alla trace. Senza, la correlazione
funziona in una direzione sola, e quella che serve più spesso è proprio questa: parti da
un errore nei log e vuoi vedere cos'altro stava facendo quella richiesta.

## Dalla UI

Connections → Data sources → il tuo Loki → **Derived fields** → Add:

| Campo         | Valore                  |
| ------------- | ----------------------- |
| Name          | `trace_id`              |
| Type          | `Label`                 |
| Label         | `trace_id`              |
| Internal link | acceso                  |
| Data source   | `Tempo (saas-template)` |
| Query         | `${__value.raw}`        |

`Type: Label` e non `Regex in log line`: i log dell'applicazione sono JSON e Loki, se il
tuo `pipeline_stages` fa il parsing JSON, espone `trace_id` come label estratta. Se non lo
fa, usa `Regex in log line` con `"trace_id":"(\w+)"`.

## Da provisioning

```yaml
datasources:
  - name: Loki
    type: loki
    uid: loki # il tuo uid esistente
    jsonData:
      derivedFields:
        - name: trace_id
          matcherType: label
          matcherRegex: trace_id
          url: '${__value.raw}'
          datasourceUid: tempo-saas
          urlDisplayLabel: 'Vedi la trace'
```

## Come sai che funziona

Apri una riga di log dell'API in Explore: deve comparire un bottone **Vedi la trace**
accanto al campo `trace_id`. Se il campo non c'è affatto, il problema è a monte — Loki non
sta facendo il parsing JSON della riga, e va sistemato lì.
