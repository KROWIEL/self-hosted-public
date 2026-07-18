# Java backend (Maven) build template.
# Multi-stage: build the JAR with Maven, then run it on a slim JRE.

FROM maven:3.9-eclipse-temurin-21@sha256:2b4496088e7b80ae10a8c9f74e574ea21380325a006ec684532ad6bad5bc7273 AS build
WORKDIR /app
# Leverage layer caching for dependencies.
COPY pom.xml ./
RUN mvn -q -DskipTests dependency:go-offline || true
COPY . .
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre@sha256:273396ed5998598ed1091e8d72711c2d36980a0e65103859c55a4e977a41ffd3
WORKDIR /app
ENV JAVA_OPTS=""
# Copy the built artifact. JAR_FILE can be overridden via build args.
ARG JAR_FILE=target/*.jar
COPY --from=build /app/${JAR_FILE} app.jar
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
