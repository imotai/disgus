import {relayInit, getEventHash, getBlankEvent, generatePrivateKey, getPublicKey, signEvent} from 'nostr-tools';

export const initPool = (relays) => {
  const pool = relays.map((relay) => relayInit(relay));

  return pool;
};

export const getComments = (config, rootEvent, force = false) => new Promise((resolve, reject) => {
  const { relays } = config;
  const pool = initPool(relays);
  let comments = [];
  let since = 0;

  if (localStorage.getItem(`e:${rootEvent.id}`)) {
    const cached = JSON.parse(localStorage.getItem(`e:${rootEvent.id}`));

    comments = cached.comments;
    if (!force) {
      resolve(comments);
      since = cached.updated_at;
    }
  }

  pool.map(async (conn) => {
    await conn.connect()
      
    const sub = conn.sub([
      {
        limit: 100,
        kinds: [1],
        since,
        '#e': [ rootEvent.id ]
      }
    ]);

    sub.on('event', (event) => {
      comments.push(event);
    });

    sub.on('eose', () => {
      // remove dupes
      comments = comments.filter((value, index, self) =>
        index === self.findIndex((t) => (
          t.id === value.id
        ))
      );
      
      const now = Math.floor(new Date().getTime() / 1000);

      localStorage.setItem(`e:${rootEvent.id}`, JSON.stringify({
          last_updated: now,
          comments
      }));
      resolve(comments);
      sub.unsub();
      conn.close();
    });
  })
});

export const getPubkey = (pubkey, relays) => new Promise((resolve, reject) => {
  let user = { pubkey, created_at: 0 };

  if (localStorage.getItem(`p:${pubkey}`)) {
    user = JSON.parse(localStorage.getItem(`p:${pubkey}`));

    console.log(user);
    if (user.created_at > 0) {
      resolve(user);
      return;
    }
  }

  const pool = initPool(relays);
  
  pool.map(async (conn) => {
    await conn.connect();
    const sub = conn.sub([
      {
        kinds: [0],
        authors: [ pubkey ]
      }
    ]);

    sub.on('event', (_event) => {
      if (!user.created_at || _event.created_at > user.created_at) {
        user = {
          ...user,
          ...JSON.parse(_event.content),
          created_at: _event.created_at
        }
        localStorage.setItem(`p:${pubkey}`, JSON.stringify(user));
        resolve(user);
      }
    });

    sub.on('eose', () => {
      sub.unsub();
      conn.close();
    });
  });
});

export const createRootEvent = (config, user) => new Promise((resolve, reject) => {
  const { pubkey, title, description, canonical, relays } = config;
  const tags = [];
  let content = title;

  if (pubkey) {
    tags.push(['p', pubkey]);
    content += ` by #[${tags.length - 1}]`;
  }

  if (description) {
    content += `\n${description}`;
  }
  
  content += `\nMore: ${canonical}\n\nComments powered by Disgus`;

  tags.push(['r', canonical]);
  tags.push(['client', 'Disgus']);
  const event = {
    content,
    tags
  };

  const randomPrivate = generatePrivateKey();
  const randomPubkey = getPublicKey(randomPrivate);

  event.pubkey = randomPubkey;
  postComment(event, randomPrivate, relays).then((_event) => {
    resolve(_event);
  });
});

export const getRootEvent = (config) => new Promise(async (resolve, reject) => {
  const { pubkey, canonical, relays } = config;
  const pool = initPool(relays);

  if (localStorage.getItem(`r:${canonical}`)) {
    resolve(JSON.parse(localStorage.getItem(`r:${canonical}`)));
    return;
  }

  const filter = { '#r': [ canonical ] };

  if (pubkey) {
    filter['#p'] = [ pubkey ];
  }

  pool.map(async (conn, i) => {
    await conn.connect();
  
    const sub = conn.sub([
      {
        limit: 1,
        kinds: [1],
        ...filter
      }
    ]);

    sub.on('event', (event) => {
      localStorage.setItem(`r:${canonical}`, JSON.stringify(event));
      resolve(event);
    });

    sub.on('eose', () => {
      sub.unsub();
      conn.close();
    });
  });
});

export const postComment = (event, user, relays) => new Promise(async(resolve, reject) => {
  const pool = initPool(relays);

  event.kind = 1;
  event.created_at = Math.floor(Date.now() / 1000);
  event.id = getEventHash(event);

  console.log(user);

  if (user && user.privateKey) {
    event.sig = signEvent(event, user.privateKey);
  } else {
    if (window.nostr) {
      const { sig } = await window.nostr.signEvent(event);

      event.sig = sig;
    } else {
      const privateKey = prompt('Enter your private key', '');
      event.sig = signEvent(event, user.privateKey);
    }
  }

  pool.map(async (conn) => {
      await conn.connect();
      const publisher = conn.publish(event);

      publisher.on('seen', (_event) => {
        resolve(_event);
      });

      publisher.on('failed', (err) => {
        alert(err.message);
        reject(_event);
      });
  });
});