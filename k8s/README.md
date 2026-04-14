# SummerSafe Infrastructure Setup Guide

This guide contains the step-by-step terminal commands to run on your fresh **Ubuntu EC2 instance** to initialize Kubernetes, install the monitoring tools, and deploy your application.

## 1. Install Docker & K3s
SSH into your EC2 instance and run:

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install K3s (Lightweight Kubernetes) without its default Traefik so we can use NGINX
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -

# Allow ubuntu user to use kubectl
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown ubuntu:ubuntu ~/.kube/config
echo "export KUBECONFIG=~/.kube/config" >> ~/.bashrc
source ~/.bashrc
```

## 2. Install Helm
Helm is the package manager for Kubernetes.

```bash
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3
chmod 700 get_helm.sh
./get_helm.sh
```

## 3. Install NGINX Ingress Controller

```bash
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

## 4. Install cert-manager (For HTTPS / Let's Encrypt)

```bash
# Add cert-manager repo & install
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Create Let's Encrypt ClusterIssuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com # CHANGE THIS TO YOUR REAL EMAIL
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

## 5. Install Prometheus & Grafana Stack

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace
```
*Note: To access Grafana locally, you can port-forward: `kubectl port-forward svc/monitoring-grafana 8080:80 -n monitoring`. The default login is `admin` / `prom-operator`.*

## 6. Install Loki & Promtail (Logging)

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# Install Loki
helm install loki grafana/loki-stack \
  --namespace logging \
  --create-namespace \
  --set grafana.enabled=false \
  --set prometheus.enabled=false \
  --set prometheus.promDail=false
```

### Adding Loki to Grafana
1. Open Grafana via Port-Forward or Ingress.
2. Go to **Connections (Data Sources)** -> Add Data Source -> **Loki**.
3. Set the URL to: `http://loki.logging.svc.cluster.local:3100` and click "Save & Test".
4. Go to **Explore**, select `Loki`, and you will see your App logs! (Your Winston JSON logs will automatically parse).

## 7. Deploying your Application

Now deploy your Kubernetes manifests:

```bash
# First, update the secrets.example.yaml with your REAL MongoDB URI and apply it:
kubectl apply -f k8s/secrets.example.yaml

# Apply the rest
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/ingress.yaml
```

## 8. Setting up Alerting in Grafana
To trigger an alert when Winstron throws `logger.error`:
1. In Grafana, click **Alerting** -> **Alert rules** -> **New alert rule**.
2. Name it "High Error Rate". Select **Loki** as the data source.
3. Use the query: `sum(rate({app="summersafe"} |= "error" [1m]))`
4. Set the condition to: `query(A, 1m, now) IS ABOVE 5` (which means > 5 errors in 1 minute).
5. Down in "Contact points", set up your Email SMTP or a Slack Webhook URL to have the alerts seamlessly routed to you.
