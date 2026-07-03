import { useState, useMemo } from 'react';
import { Tabs, TabPane, Select, Input, Typography, Banner, Button, Toast, Space, Card } from '@douyinfe/semi-ui';
import { Copy } from 'lucide-react';
import { config } from '@/config';
import { useOpenAppOptions } from '@/hooks/queries/open-platform';

const { Text, Title } = Typography;

function CodeBlock({ code }: { code: string }) {
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => Toast.success('已复制'));
  };
  return (
    <div style={{ position: 'relative', marginBottom: 16 }}>
      <Button
        size="small"
        theme="borderless"
        icon={<Copy size={13} />}
        onClick={copy}
        style={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}
      >
        复制
      </Button>
      <pre style={{ background: 'var(--semi-color-fill-0)', padding: 14, borderRadius: 6, overflow: 'auto', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function SdkExamplesPage() {
  const [appKey, setAppKey] = useState('YOUR_APP_KEY');
  const [secret, setSecret] = useState('YOUR_APP_SECRET');
  const appOptionsQuery = useOpenAppOptions();
  const appOptions = appOptionsQuery.data ?? [];

  const base = useMemo(() => {
    const origin = config.apiBaseUrl || window.location.origin;
    return `${origin.replace(/\/$/, '')}/api/open/v1`;
  }, []);

  const snippets = useMemo(() => buildSnippets(appKey, secret, base), [appKey, secret, base]);

  return (
    <div className="page-container">
      <Card style={{ marginBottom: 16 }}>
        <Banner
          type="info"
          description="开放 API 采用 HMAC-SHA256 签名鉴权。选择应用自动填入 AppKey，填写对应 AppSecret（创建应用时返回的 clientSecret），下方代码即可直接复制使用。"
          style={{ marginBottom: 16 }}
        />
        <Space wrap align="end">
          <div>
            <div style={{ marginBottom: 4 }}><Text type="tertiary" size="small">选择应用（自动填入 AppKey）</Text></div>
            <Select
              placeholder="选择应用"
              style={{ width: 240 }}
              filter
              optionList={appOptions.map((a) => ({ value: a.clientId, label: a.name }))}
              onChange={(v) => setAppKey((v as string) || 'YOUR_APP_KEY')}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}><Text type="tertiary" size="small">AppKey</Text></div>
            <Input value={appKey} onChange={setAppKey} style={{ width: 300 }} />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}><Text type="tertiary" size="small">AppSecret</Text></div>
            <Input value={secret} onChange={setSecret} mode="password" style={{ width: 300 }} />
          </div>
        </Space>
        <div style={{ marginTop: 12 }}>
          <Text type="tertiary" size="small">网关地址：</Text>
          <Text code copyable={{ content: base }}>{base}</Text>
        </div>
      </Card>

      <Card>
        <Tabs type="line">
          {(['cURL', 'Node.js', 'Python', 'Java', 'Go'] as const).map((lang) => (
            <TabPane tab={lang} itemKey={lang} key={lang}>
              <Title heading={6} style={{ margin: '8px 0' }}>① 签名并调用开放 API</Title>
              <CodeBlock code={snippets[lang].call} />
              <Title heading={6} style={{ margin: '8px 0' }}>② 校验 Webhook 签名</Title>
              <CodeBlock code={snippets[lang].verify} />
            </TabPane>
          ))}
        </Tabs>
      </Card>
    </div>
  );
}

function buildSnippets(appKey: string, secret: string, base: string) {
  const curl = `#!/usr/bin/env bash
APP_KEY="${appKey}"
APP_SECRET="${secret}"
BASE="${base}"

TS=$(date +%s)
NONCE=$(openssl rand -hex 8)
BODY=""
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 -hex | sed 's/^.* //')
# stringToSign = METHOD\\nPATH\\nCANONICAL_QUERY\\nTS\\nNONCE\\nSHA256(BODY)
STS=$(printf 'GET\\n/api/open/v1/ping\\n\\n%s\\n%s\\n%s' "$TS" "$NONCE" "$BODY_HASH")
SIG=$(printf '%s' "$STS" | openssl dgst -sha256 -hmac "$APP_SECRET" -hex | sed 's/^.* //')

curl "$BASE/ping" \\
  -H "X-App-Key: $APP_KEY" \\
  -H "X-Timestamp: $TS" \\
  -H "X-Nonce: $NONCE" \\
  -H "X-Signature: $SIG"`;

  const curlVerify = `# Webhook 请求头：X-Zenith-Signature: t=<ts>,v1=<sig>
# 待签名串 = "<ts>.<原始请求体>"，HMAC-SHA256(secret) 后比对 v1
TS=$(echo "$SIG_HEADER" | sed -n 's/.*t=\\([0-9]*\\).*/\\1/p')
V1=$(echo "$SIG_HEADER" | sed -n 's/.*v1=\\([a-f0-9]*\\).*/\\1/p')
EXPECT=$(printf '%s.%s' "$TS" "$RAW_BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')
[ "$V1" = "$EXPECT" ] && echo "valid" || echo "invalid"`;

  const node = `const crypto = require('crypto');
const APP_KEY = '${appKey}';
const APP_SECRET = '${secret}';
const BASE = '${base}';

function signHeaders(method, path, query = '', body = '') {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const cq = query ? query.split('&').filter(Boolean).sort().join('&') : '';
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const stringToSign = [method.toUpperCase(), path, cq, ts, nonce, bodyHash].join('\\n');
  const signature = crypto.createHmac('sha256', APP_SECRET).update(stringToSign).digest('hex');
  return { 'X-App-Key': APP_KEY, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': signature };
}

const headers = signHeaders('GET', '/api/open/v1/ping');
const res = await fetch(BASE + '/ping', { headers });
console.log(await res.json());`;

  const nodeVerify = `// Express 示例：校验 Webhook 签名（需 raw body）
const crypto = require('crypto');
function verifyWebhook(rawBody, sigHeader, secret) {
  const m = /t=(\\d+),v1=([a-f0-9]+)/.exec(sigHeader || '');
  if (!m) return false;
  const [, ts, v1] = m;
  const expected = crypto.createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex');
  return v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}`;

  const python = `import time, os, hmac, hashlib, requests

APP_KEY = '${appKey}'
APP_SECRET = '${secret}'
BASE = '${base}'

def sign_headers(method, path, query='', body=''):
    ts = str(int(time.time()))
    nonce = os.urandom(8).hex()
    cq = '&'.join(sorted([p for p in query.split('&') if p])) if query else ''
    body_hash = hashlib.sha256(body.encode()).hexdigest()
    string_to_sign = '\\n'.join([method.upper(), path, cq, ts, nonce, body_hash])
    sig = hmac.new(APP_SECRET.encode(), string_to_sign.encode(), hashlib.sha256).hexdigest()
    return {'X-App-Key': APP_KEY, 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': sig}

resp = requests.get(BASE + '/ping', headers=sign_headers('GET', '/api/open/v1/ping'))
print(resp.json())`;

  const pythonVerify = `import hmac, hashlib, re

def verify_webhook(raw_body: str, sig_header: str, secret: str) -> bool:
    m = re.search(r't=(\\d+),v1=([a-f0-9]+)', sig_header or '')
    if not m:
        return False
    ts, v1 = m.group(1), m.group(2)
    expected = hmac.new(secret.encode(), f'{ts}.{raw_body}'.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(v1, expected)`;

  const java = `import java.net.http.*;
import java.net.URI;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;

String appKey = "${appKey}", appSecret = "${secret}", base = "${base}";
String ts = String.valueOf(System.currentTimeMillis() / 1000);
String nonce = java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 16);
String bodyHash = hex(MessageDigest.getInstance("SHA-256").digest("".getBytes()));
String stringToSign = String.join("\\n", "GET", "/api/open/v1/ping", "", ts, nonce, bodyHash);
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(appSecret.getBytes(), "HmacSHA256"));
String sig = hex(mac.doFinal(stringToSign.getBytes()));

HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/ping"))
    .header("X-App-Key", appKey).header("X-Timestamp", ts)
    .header("X-Nonce", nonce).header("X-Signature", sig).build();
HttpResponse<String> resp = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
System.out.println(resp.body());
// hex(byte[]) 为字节数组转十六进制小写字符串的工具方法`;

  const javaVerify = `// 校验 Webhook：解析 t / v1，HMAC-SHA256("<t>.<rawBody>") 后用常量时间比对
Matcher m = Pattern.compile("t=(\\\\d+),v1=([a-f0-9]+)").matcher(sigHeader);
if (m.find()) {
    String ts = m.group(1), v1 = m.group(2);
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(), "HmacSHA256"));
    String expected = hex(mac.doFinal((ts + "." + rawBody).getBytes()));
    boolean ok = MessageDigest.isEqual(v1.getBytes(), expected.getBytes());
}`;

  const go = `package main

import (
  "crypto/hmac"; "crypto/sha256"; "encoding/hex"; "fmt"
  "net/http"; "strconv"; "time"; "crypto/rand"
)

const appKey, appSecret, base = "${appKey}", "${secret}", "${base}"

func signHeaders(method, path, query, body string) map[string]string {
  ts := strconv.FormatInt(time.Now().Unix(), 10)
  b := make([]byte, 8); rand.Read(b); nonce := hex.EncodeToString(b)
  bh := sha256.Sum256([]byte(body))
  sts := method + "\\n" + path + "\\n" + query + "\\n" + ts + "\\n" + nonce + "\\n" + hex.EncodeToString(bh[:])
  mac := hmac.New(sha256.New, []byte(appSecret)); mac.Write([]byte(sts))
  return map[string]string{"X-App-Key": appKey, "X-Timestamp": ts, "X-Nonce": nonce, "X-Signature": hex.EncodeToString(mac.Sum(nil))}
}

func main() {
  req, _ := http.NewRequest("GET", base+"/ping", nil)
  for k, v := range signHeaders("GET", "/api/open/v1/ping", "", "") { req.Header.Set(k, v) }
  resp, _ := http.DefaultClient.Do(req); defer resp.Body.Close()
  fmt.Println(resp.Status)
}`;

  const goVerify = `// 校验 Webhook：header 形如 t=<ts>,v1=<sig>
func verifyWebhook(rawBody, sigHeader, secret string) bool {
  var ts, v1 string
  fmt.Sscanf(sigHeader, "t=%[^,],v1=%s", &ts, &v1)
  mac := hmac.New(sha256.New, []byte(secret)); mac.Write([]byte(ts + "." + rawBody))
  return hmac.Equal([]byte(v1), []byte(hex.EncodeToString(mac.Sum(nil))))
}`;

  return {
    'cURL': { call: curl, verify: curlVerify },
    'Node.js': { call: node, verify: nodeVerify },
    'Python': { call: python, verify: pythonVerify },
    'Java': { call: java, verify: javaVerify },
    'Go': { call: go, verify: goVerify },
  };
}
