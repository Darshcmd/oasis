#define TRIG_PIN 5
#define ECHO_PIN 18
#define RELAY_PIN 23

float EMPTY_DIST = 12.0;
float FULL_DIST  = 3.0;

int ON_THRESHOLD = 90;
int OFF_THRESHOLD = 70;

long duration;
float distance;
float percentage;

bool pumpState = false;

float getDistance() {
  float sum = 0;

  for (int i = 0; i < 5; i++) {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);

    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    duration = pulseIn(ECHO_PIN, HIGH, 30000);
    float d = duration * 0.034 / 2;

    sum += d;
    delay(50);
  }

  return sum / 5.0;
}

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);

  digitalWrite(RELAY_PIN, HIGH);
}

void loop() {

  distance = getDistance();

  // Raw %
  float rawPercentage = (EMPTY_DIST - distance) * 100.0 / (EMPTY_DIST - FULL_DIST);

  // 🔥 Normalized %
  percentage = 0.7 * rawPercentage + 44;

  // Clamp
  if (percentage > 100) percentage = 100;
  if (percentage < 0) percentage = 0;

  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.print(" cm | Water Level: ");
  Serial.print(percentage);
  Serial.println(" %");

  // Pump control
  if (percentage >= ON_THRESHOLD && !pumpState) {
    digitalWrite(RELAY_PIN, LOW);
    pumpState = true;
    Serial.println("Pump ON");
  }

  if (percentage <= OFF_THRESHOLD && pumpState) {
    digitalWrite(RELAY_PIN, HIGH);
    pumpState = false;
    Serial.println("Pump OFF");
  }

  delay(1000);
}