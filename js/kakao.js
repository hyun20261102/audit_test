// 카카오 지도 SDK 로딩 및 주소 → 좌표 변환 (캐시 + 단계별 대체 검색)
const Kakao = {
  ready: false,
  geocoder: null,
  places: null,
  cache: Store.get('geoCache', {}),

  load(appKey) {
    return new Promise((resolve, reject) => {
      if (!appKey) return reject(new Error('JavaScript 키가 없습니다.'));
      if (location.protocol === 'file:') return reject(new Error('index.html을 직접 열었습니다. 실행.bat로 http://localhost:8080 에서 여세요.'));
      if (window.kakao && window.kakao.maps && this.ready) return resolve();
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false`;
      s.onerror = () => reject(new Error(`SDK 로드 거부 — ① JavaScript 키인지 ② Web 도메인에 ${location.origin} 등록 ③ 카카오맵 사용설정 ON 확인`));
      s.onload = () => {
        if (!window.kakao || !kakao.maps) return reject(new Error('카카오 SDK 초기화 실패 (도메인 등록/키 확인)'));
        kakao.maps.load(() => {
          this.geocoder = new kakao.maps.services.Geocoder();
          this.places = new kakao.maps.services.Places();
          this.ready = true;
          resolve();
        });
      };
      document.head.appendChild(s);
    });
  },

  _addressSearch(q) {
    return new Promise(res => {
      this.geocoder.addressSearch(q, (result, status) => {
        if (status === kakao.maps.services.Status.OK && result.length) {
          const r = result[0];
          res({ lat: +r.y, lng: +r.x, matched: r.address_name });
        } else if (status === kakao.maps.services.Status.ERROR) {
          res({ error: true });
        } else res(null);
      });
    });
  },

  _keywordSearch(q) {
    return new Promise(res => {
      this.places.keywordSearch(q, (result, status) => {
        if (status === kakao.maps.services.Status.OK && result.length) {
          const r = result[0];
          res({ lat: +r.y, lng: +r.x, matched: `${r.place_name} (${r.road_address_name || r.address_name})` });
        } else res(null);
      }, { size: 1 });
    });
  },

  // 주소 후보: 원문 → 도로명+건물번호까지 → 지번(동+번지)까지
  addressCandidates(addr) {
    const a = normAddr(addr);
    const c = [a];
    const road = a.match(/^(.+?(?:로|길)\s?\d+(?:-\d+)?)(?=\s|$)/);
    if (road) c.push(road[1]);
    const jibun = a.match(/^(.+?[동리가]\s?(?:산\s?)?\d+(?:-\d+)?)(?=\s|$)/);
    if (jibun) c.push(jibun[1]);
    return [...new Set(c.filter(Boolean))];
  },

  // 반환: {lat,lng,matched,level:'주소'|'주소(보정)'|'상호검색'} 또는 null
  async geocode(addr, merchantName) {
    const a = normAddr(addr);
    const aKey = 'A:' + a;
    if (a && this.cache[aKey]) return this.cache[aKey];

    let hit = null;
    const cands = a ? this.addressCandidates(a) : [];
    for (let i = 0; i < cands.length && !hit; i++) {
      const r = await this._addressSearch(cands[i]);
      if (r && r.error) throw new Error('카카오 API 오류 (도메인 등록 또는 키 확인 필요)');
      if (r) hit = { ...r, level: i === 0 ? '주소' : '주소(보정)' };
    }
    if (hit) {
      this.cache[aKey] = hit;
      this.saveCache();
      return hit;
    }
    // 주소로 못 찾으면 상호명 + 시군구로 장소 검색
    if (merchantName) {
      const name = merchantName.replace(/\(주\)|주식회사|㈜/g, '').split(' - ').pop().trim();
      const q = `${a.split(' ').slice(0, 2).join(' ')} ${name}`.trim();
      const kKey = 'K:' + q;
      if (this.cache[kKey]) return this.cache[kKey];
      hit = await this._keywordSearch(q);
      if (hit) {
        hit.level = '상호검색';
        this.cache[kKey] = hit;
        this.saveCache();
      }
    }
    return hit;
  },

  saveCache() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => Store.set('geoCache', this.cache), 300);
  },

  clearCache() {
    this.cache = {};
    Store.remove('geoCache');
  },
};
