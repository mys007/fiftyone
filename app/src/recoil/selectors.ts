import { selector, selectorFamily } from "recoil";
import ReconnectingWebSocket from "reconnecting-websocket";
import uuid from "uuid-v4";

import * as atoms from "./atoms";
import { generateColorMap } from "../utils/colors";
import { isElectron } from "../utils/generic";
import {
  RESERVED_FIELDS,
  VALID_LABEL_TYPES,
  VALID_LIST_TYPES,
  VALID_SCALAR_TYPES,
  makeLabelNameGroups,
  labelTypeHasColor,
  AGGS,
} from "../utils/labels";
import { packageMessage } from "../utils/socket";
import { viewsAreEqual } from "../utils/view";
import { lightTheme } from "../shared/colors";

class HTTPSSocket {
  location: string;
  events: {
    [name: string]: Set<(data: object) => void>;
  } = {};
  readyState: number = WebSocket.CONNECTING;
  openTimeout: number = 2000;
  timeout: number = 2000;
  interval: number;

  constructor(location: string) {
    this.location = location;
    this.connect();
  }

  connect() {
    this.gather();
    this.interval = setInterval(() => this.gather(), this.timeout);
  }

  execute(messages) {
    if ([WebSocket.CLOSED, WebSocket.CONNECTING].includes(this.readyState)) {
      this.events.open.forEach((h) => h(null));
      this.timeout = this.openTimeout;
      clearInterval(this.interval);
      this.interval = setInterval(() => this.gather(), this.timeout);
    }
    this.readyState = WebSocket.OPEN;
    messages.forEach((m) => {
      fetch(this.location + "&mode=pull", {
        method: "post",
        body: JSON.stringify(m),
      })
        .then((response) => response.json())
        .then((data) => {
          this.events.message.forEach((h) => h({ data: JSON.stringify(data) }));
        });
    });
  }

  gather() {
    fetch(this.location)
      .then((response) => response.json())
      .then(({ messages }) => this.execute(messages))
      .catch(() => {
        if (this.readyState === WebSocket.OPEN && this.events.close) {
          this.events.close.forEach((h) => h(null));
        }
        this.readyState = WebSocket.CLOSED;
        clearInterval(this.interval);
        this.timeout = Math.min(this.timeout * 2, 5000);
        this.interval = setInterval(() => this.gather(), this.timeout);
      });
  }

  addEventListener(eventType, handler) {
    if (!this.events[eventType]) {
      this.events[eventType] = new Set();
    }
    this.events[eventType].add(handler);
  }

  removeEventListener(eventType, handler) {
    this.events[eventType].delete(handler);
  }

  send(message) {
    fetch(this.location + "&mode=push", {
      method: "post",
      body: message,
    })
      .then((response) => response.json())
      .then((data) => {
        const { messages, type } = data;
        messages && this.execute(messages);
        type &&
          this.events.message.forEach((h) => h({ data: JSON.stringify(data) }));
      });
  }
}

export const sessionId = uuid();

export const handleId = selector({
  key: "handleId",
  get: () => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    return params.get("handleId");
  },
});

export const deactivated = selector({
  key: "deactivated",
  get: ({ get }) => {
    const handle = get(handleId);
    const activeHandle = get(atoms.stateDescription)?.active_handle;
    const notebook = get(isNotebook);
    if (notebook) {
      return handle !== activeHandle && typeof activeHandle === "string";
    }
    return false;
  },
});

const host =
  process.env.NODE_ENV === "development"
    ? "localhost:5151"
    : window.location.host;

export const port = selector({
  key: "port",
  get: ({ get }) => {
    if (isElectron()) {
      return parseInt(process.env.FIFTYONE_SERVER_PORT) || 5151;
    }
    return parseInt(window.location.port);
  },
});

export const http = selector({
  key: "http",
  get: ({ get }) => {
    if (isElectron()) {
      return `http://localhost:${get(port)}`;
    } else {
      const loc = window.location;
      return loc.protocol + "//" + host;
    }
  },
});

export const ws = selector({
  key: "ws",
  get: ({ get }) => {
    if (isElectron()) {
      return `ws://localhost:${get(port)}/state`;
    }
    let url = null;
    const loc = window.location;
    if (loc.protocol === "https:") {
      url = "wss:";
    } else {
      url = "ws:";
    }
    return url + "//" + host + "/state";
  },
});

export const fiftyone = selector({
  key: "fiftyone",
  get: async ({ get }) => {
    let response = null;
    do {
      try {
        response = await fetch(`${get(http)}/fiftyone`);
      } catch {}
      if (response) break;
      await new Promise((r) => setTimeout(r, 2000));
    } while (response === null);
    const data = await response.json();
    return data;
  },
});

export const showFeedbackButton = selector({
  key: "showFeedbackButton",
  get: ({ get }) => {
    const feedback = get(fiftyone).feedback;
    const localFeedback = get(atoms.feedbackSubmitted);
    const storedFeedback = window.localStorage.getItem("fiftyone-feedback");
    if (storedFeedback) {
      window.localStorage.removeItem("fiftyone-feedback");
      fetch(`${get(http)}/feedback?submitted=true`, { method: "post" });
    }
    if (
      feedback.submitted ||
      localFeedback.submitted ||
      storedFeedback === "submitted"
    ) {
      return "hidden";
    }
    if (feedback.minimized || localFeedback.minimized) {
      return "minimized";
    }
    return "shown";
  },
});

export const isColab = selector({
  key: "isColab",
  get: () => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    return params.get("fiftyoneColab");
  },
});

export const isNotebook = selector({
  key: "isNotebook",
  get: () => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    return params.get("notebook");
  },
});

export const appContext = selector({
  key: "appContext",
  get: ({ get }) => {
    const electron = isElectron();
    const notebook = get(isNotebook);
    const colab = get(isNotebook);
    if (electron) {
      return "desktop";
    }
    if (colab) {
      return "colab";
    }
    if (notebook) {
      return "notebook";
    }
    return "browser";
  },
});

export const socket = selector({
  key: "socket",
  get: ({ get }): ReconnectingWebSocket | HTTPSSocket => {
    if (get(isColab)) {
      return new HTTPSSocket(`${get(http)}/polling?sessionId=${sessionId}`);
    } else {
      return new ReconnectingWebSocket(get(ws));
    }
  },
  dangerouslyAllowMutability: true,
});

export const datasetName = selector({
  key: "datasetName",
  get: ({ get }) => {
    const stateDescription = get(atoms.stateDescription);
    return stateDescription.dataset ? stateDescription.dataset.name : null;
  },
});

export const datasets = selector({
  key: "datasets",
  get: ({ get }) => {
    return get(atoms.stateDescription).datasets ?? [];
  },
});

export const hasDataset = selector({
  key: "hasDataset",
  get: ({ get }) => Boolean(get(datasetName)),
});

export const mediaType = selector({
  key: "mediaType",
  get: ({ get }) => {
    const stateDescription = get(atoms.stateDescription);
    return stateDescription.dataset
      ? stateDescription.dataset.media_type
      : null;
  },
});

export const isVideoDataset = selector({
  key: "isVideoDataset",
  get: ({ get }) => {
    return get(mediaType) === "video";
  },
});

export const view = selector<[]>({
  key: "view",
  get: ({ get }) => {
    return get(atoms.stateDescription).view || [];
  },
  set: ({ get, set }, stages) => {
    const state = get(atoms.stateDescription);
    const newState = {
      ...state,
      view: stages,
    };
    set(atoms.stateDescription, newState);
    get(socket).send(packageMessage("update", { state: newState }));
  },
});

export const filterStages = selector({
  key: "filterStages",
  get: ({ get }) => {
    return get(atoms.stateDescription).filters;
  },
  set: ({ get, set }, filters) => {
    const state = {
      ...get(atoms.stateDescription),
      filters,
    };
    const sock = get(socket);
    sock.send(packageMessage("filters_update", { filters }));
    set(atoms.stateDescription, state);
  },
});

export const filterStage = selectorFamily({
  key: "filterStage",
  get: (path) => ({ get }) => {
    console.log(get(filterStages));
    return get(filterStages)?.[path] ?? {};
  },
  set: (path: string) => ({ get, set }, value) => {
    const filters = Object.assign({}, get(filterStages));
    if (!value && !filters[path]) return;
    if (JSON.stringify(value) === JSON.stringify(filters[path])) return;
    if (!value && path in filters) {
      delete filters[path];
    } else {
      filters[path] = value;
    }
    set(filterStages, filters);
  },
});

export const paginatedFilterStages = selector({
  key: "paginatedFilterStages",
  get: ({ get }) => {
    const scalars = get(scalarNames("sample"));
    const filters = get(filterStages);
    return Object.keys(filters).reduce((acc, cur) => {
      if (scalars.includes(cur)) {
        acc[cur] = filters[cur];
      }
      return acc;
    }, {});
  },
});

export const datasetStats = selector({
  key: "datasetStats",
  get: ({ get }) => {
    const raw = get(atoms.datasetStatsRaw);
    const currentView = get(view);
    if (!raw.view) {
      return null;
    }
    if (viewsAreEqual(raw.view, currentView)) {
      return raw.stats;
    }
    return null;
  },
});

const normalizeFilters = (filters) => {
  const names = Object.keys(filters).sort();
  const list = names.map((n) => filters[n]);
  return JSON.stringify([names, list]);
};

const filtersAreEqual = (filtersOne, filtersTwo) => {
  return normalizeFilters(filtersOne) === normalizeFilters(filtersTwo);
};

export const extendedDatasetStats = selector({
  key: "extendedDatasetStats",
  get: ({ get }) => {
    const raw = get(atoms.extendedDatasetStatsRaw);
    const currentView = get(view);
    if (!raw.view) {
      return null;
    }
    if (!viewsAreEqual(raw.view, currentView)) {
      return null;
    }
    const currentFilters = get(filterStages);
    if (!filtersAreEqual(raw.filters, currentFilters)) {
      return null;
    }

    return raw.stats;
  },
});

export const totalCount = selector({
  key: "totalCount",
  get: ({ get }): number => {
    const stats = get(datasetStats) || [];
    return stats.reduce(
      (acc, cur) => (cur.name === null ? cur.result : acc),
      null
    );
  },
});

export const filteredCount = selector({
  key: "filteredCount",
  get: ({ get }): number => {
    const stats = get(extendedDatasetStats) || [];
    return stats.reduce(
      (acc, cur) => (cur.name === null ? cur.result : acc),
      null
    );
  },
});

export const tagNames = selector({
  key: "tagNames",
  get: ({ get }) => {
    return (get(datasetStats) ?? []).reduce((acc, cur) => {
      if (cur.name === "tags") {
        return Object.keys(cur.result).sort();
      }
      return acc;
    }, []);
  },
});

export const tagSampleCounts = selector({
  key: "tagSampleCounts",
  get: ({ get }) => {
    return (get(datasetStats) ?? []).reduce((acc, cur) => {
      if (cur.name === "tags") {
        return cur.result;
      }
      return acc;
    }, {});
  },
});

export const filteredTagSampleCounts = selector({
  key: "filteredTagSampleCounts",
  get: ({ get }) => {
    return (get(datasetStats) ?? []).reduce((acc, cur) => {
      if (cur.name === "tags") {
        return cur.result;
      }
      return acc;
    }, {});
  },
});

export const fieldSchema = selectorFamily({
  key: "fieldSchema",
  get: (dimension: string) => ({ get }) => {
    const d = get(atoms.stateDescription).dataset || {};
    return d[dimension + "_fields"] || [];
  },
});

const labelFilter = (f) => {
  return (
    f.embedded_doc_type &&
    VALID_LABEL_TYPES.includes(f.embedded_doc_type.split(".").slice(-1)[0])
  );
};

const scalarFilter = (f) => {
  return VALID_SCALAR_TYPES.includes(f.ftype);
};

const fields = selectorFamily({
  key: "fields",
  get: (dimension: string) => ({ get }) => {
    return get(fieldSchema(dimension)).reduce((acc, cur) => {
      acc[cur.name] = cur;
      return acc;
    }, {});
  },
});

const selectedFields = selectorFamily({
  key: "selectedFields",
  get: (dimension: string) => ({ get }) => {
    const view_ = get(view);
    const fields_ = { ...get(fields(dimension)) };
    const video = get(isVideoDataset);
    view_.forEach(({ _cls, kwargs }) => {
      if (_cls === "fiftyone.core.stages.SelectFields") {
        const supplied = kwargs[0][1] ? kwargs[0][1] : [];
        let names = new Set([...supplied, ...RESERVED_FIELDS]);
        if (video && dimension === "frame") {
          names = new Set(
            Array.from(names).map((n) => n.slice("frames.".length))
          );
        }
        Object.keys(fields_).forEach((f) => {
          if (!names.has(f)) {
            delete fields_[f];
          }
        });
      } else if (_cls === "fiftyone.core.stages.ExcludeFields") {
        const supplied = kwargs[0][1] ? kwargs[0][1] : [];
        let names = Array.from(supplied);

        if (video && dimension === "frame") {
          names = names.map((n) => n.slice("frames.".length));
        } else if (video) {
          names = names.filter((n) => n.startsWith("frames."));
        }
        names.forEach((n) => {
          delete fields_[n];
        });
      }
    });
    return fields_;
  },
});

export const defaultPlayerOverlayOptions = selector({
  key: "defaultPlayerOverlayOptions",
  get: ({ get }) => {
    const showAttrs = get(appConfig).show_attributes;
    const showConfidence = get(appConfig).show_confidence;
    return {
      showAttrs,
      showConfidence,
    };
  },
});

export const playerOverlayOptions = selector({
  key: "playerOverlayOptions",
  get: ({ get }) => {
    return {
      ...get(defaultPlayerOverlayOptions),
      ...get(atoms.savedPlayerOverlayOptions),
    };
  },
});

export const fieldPaths = selector({
  key: "fieldPaths",
  get: ({ get }) => {
    const excludePrivateFilter = (f) => !f.startsWith("_");
    const fieldsNames = Object.keys(get(selectedFields("sample"))).filter(
      excludePrivateFilter
    );
    if (get(mediaType) === "video") {
      return fieldsNames
        .concat(
          Object.keys(get(selectedFields("frame")))
            .filter(excludePrivateFilter)
            .map((f) => "frames." + f)
        )
        .sort();
    }
    return fieldsNames.sort();
  },
});

const labels = selectorFamily({
  key: "labels",
  get: (dimension: string) => ({ get }) => {
    const fieldsValue = get(selectedFields(dimension));
    return Object.keys(fieldsValue)
      .map((k) => fieldsValue[k])
      .filter(labelFilter);
  },
});

export const labelNames = selectorFamily({
  key: "labelNames",
  get: (dimension: string) => ({ get }) => {
    const l = get(labels(dimension));
    return l.map((l) => l.name);
  },
});

export const labelPaths = selector({
  key: "labelPaths",
  get: ({ get }) => {
    const sampleLabels = get(labelNames("sample"));
    const frameLabels = get(labelNames("frame"));
    return sampleLabels.concat(frameLabels.map((l) => "frames." + l));
  },
});

export const labelTypes = selectorFamily({
  key: "labelTypes",
  get: (dimension: string) => ({ get }) => {
    return get(labels(dimension)).map((l) => {
      return l.embedded_doc_type.split(".").slice(-1)[0];
    });
  },
});

const scalars = selectorFamily({
  key: "scalars",
  get: (dimension: string) => ({ get }) => {
    const fieldsValue = get(selectedFields(dimension));
    return Object.keys(fieldsValue)
      .map((k) => fieldsValue[k])
      .filter(scalarFilter);
  },
});

export const scalarNames = selectorFamily({
  key: "scalarNames",
  get: (dimension: string) => ({ get }) => {
    const l = get(scalars(dimension));
    return l.map((l) => l.name);
  },
});

export const scalarTypes = selectorFamily({
  key: "scalarTypes",
  get: (dimension: string) => ({ get }) => {
    const l = get(scalars(dimension));
    return l.map((l) => l.ftype);
  },
});

const COUNT_CLS = "Count";
const BOUNDS_CLS = "Bounds";
const CONFIDENCE_BOUNDS_CLS = "Bounds";

export const labelsPath = selectorFamily({
  key: "labelsPath",
  get: (path: string) => ({ get }) => {
    const isVideo = get(isVideoDataset);
    const dimension =
      isVideo && path.startsWith("frames.") ? "frame" : "sample";
    const label = dimension === "frame" ? path.slice("frames.".length) : path;
    const type = get(labelMap(dimension))[label];
    if (VALID_LIST_TYPES.includes(type)) {
      return `${path}.${type.toLowerCase()}.label`;
    }
    return `${path}.label`;
  },
});

export const labelClasses = selectorFamily<string[], string>({
  key: "labelClasses",
  get: (label) => ({ get }) => {
    const path = get(labelsPath(label));
    return (get(datasetStats) ?? []).reduce((acc, cur) => {
      if (cur.name === path && cur._CLS === AGGS.DISTINCT) {
        return cur.result;
      }
      return acc;
    }, []);
  },
});

const catchLabelCount = (names, prefix, cur, acc) => {
  if (
    cur.name &&
    names.includes(cur.name.slice(prefix.length).split(".")[0]) &&
    cur._CLS === COUNT_CLS
  ) {
    acc[cur.name.slice(prefix.length).split(".")[0]] = cur.result;
  }
};

export const labelSampleCounts = selectorFamily({
  key: "labelSampleCounts",
  get: (dimension: string) => ({ get }) => {
    const names = get(labelNames(dimension)).concat(
      get(scalarNames(dimension))
    );
    const prefix = dimension === "sample" ? "" : "frames.";
    const stats = get(datasetStats);
    if (stats === null) {
      return null;
    }
    return stats.reduce((acc, cur) => {
      catchLabelCount(names, prefix, cur, acc);
      return acc;
    }, {});
  },
});

export const filteredLabelSampleCounts = selectorFamily({
  key: "filteredLabelSampleCounts",
  get: (dimension: string) => ({ get }) => {
    const names = get(labelNames(dimension)).concat(
      get(scalarNames(dimension))
    );
    const prefix = dimension === "sample" ? "" : "frames.";
    const stats = get(extendedDatasetStats);
    if (stats === null) {
      return null;
    }
    return stats.reduce((acc, cur) => {
      catchLabelCount(names, prefix, cur, acc);
      return acc;
    }, {});
  },
});

export const labelTuples = selectorFamily({
  key: "labelTuples",
  get: (dimension: string) => ({ get }) => {
    const types = get(labelTypes(dimension));
    return get(labelNames(dimension)).map((n, i) => [n, types[i]]);
  },
});

export const labelMap = selectorFamily({
  key: "labelMap",
  get: (dimension: string) => ({ get }) => {
    const tuples = get(labelTuples(dimension));
    return tuples.reduce((acc, cur) => {
      return {
        [cur[0]]: cur[1],
        ...acc,
      };
    }, {});
  },
});

export const scalarsMap = selectorFamily<{ [key: string]: string }, string>({
  key: "scalarsMap",
  get: (dimension) => ({ get }) => {
    const types = get(scalarTypes(dimension));
    return get(scalarNames(dimension)).reduce(
      (acc, cur, i) => ({
        ...acc,
        [cur]: types[i],
      }),
      {}
    );
  },
});

export const appConfig = selector({
  key: "appConfig",
  get: ({ get }) => {
    return get(atoms.stateDescription).config || {};
  },
});

export const colorPool = selector({
  key: "colorPool",
  get: ({ get }) => {
    return get(appConfig).color_pool || [];
  },
});

export const colorMap = selector({
  key: "colorMap",
  get: ({ get }) => {
    let pool = get(colorPool);
    pool = pool.length ? pool : [lightTheme.brand];
    const seed = get(atoms.colorSeed);
    const colorLabelNames = get(labelTuples("sample"))
      .filter(([name, type]) => labelTypeHasColor(type))
      .map(([name]) => name);
    const colorFrameLabelNames = get(labelTuples("frame"))
      .filter(([name, type]) => labelTypeHasColor(type))
      .map(([name]) => "frames." + name);
    const scalarsList = [
      ...get(scalarNames("sample")),
      ...get(scalarNames("frame")),
    ];

    return generateColorMap(
      pool,
      [
        ...get(tagNames),
        ...scalarsList,
        ...colorLabelNames,
        ...colorFrameLabelNames,
      ],
      seed
    );
  },
});

export const labelConfidenceBounds = selectorFamily({
  key: "labelConfidenceBounds",
  get: (label) => ({ get }) => {
    return (get(datasetStats) ?? []).reduce(
      (acc, cur) => {
        if (
          cur.name &&
          cur.name.includes(label) &&
          cur._CLS === CONFIDENCE_BOUNDS_CLS
        ) {
          let bounds = cur.result;
          bounds = [
            0 < bounds[0] ? 0 : bounds[0],
            1 > bounds[1] ? 1 : bounds[1],
          ];
          return [
            bounds[0] !== null && bounds[0] !== 0
              ? Number((bounds[0] - 0.01).toFixed(2))
              : bounds[0],
            bounds[1] !== null && bounds[1] !== 1
              ? Number((bounds[1] + 0.01).toFixed(2))
              : bounds[1],
          ];
        }
        return acc;
      },
      [null, null]
    );
  },
});

export const numericFieldBounds = selectorFamily({
  key: "numericFieldBounds",
  get: (label) => ({ get }) => {
    return (get(datasetStats) ?? []).reduce(
      (acc, cur) => {
        if (cur.name === label && cur._CLS === BOUNDS_CLS) {
          const { result: bounds } = cur;
          return [
            bounds[0] !== null && bounds[0] !== 0
              ? Number((bounds[0] - 0.01).toFixed(2))
              : bounds[0],
            bounds[1] !== null && bounds[1] !== 1
              ? Number((bounds[1] + 0.01).toFixed(2))
              : bounds[1],
          ];
        }
        return acc;
      },
      [null, null]
    );
  },
});

export const labelNameGroups = selectorFamily({
  key: "labelNameGroups",
  get: (dimension: string) => ({ get }) =>
    makeLabelNameGroups(
      get(selectedFields(dimension)),
      get(labelNames(dimension)),
      get(labelTypes(dimension))
    ),
});
